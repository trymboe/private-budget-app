import "server-only";
import { createHash, createPrivateKey, type KeyObject } from "node:crypto";
import { SignJWT } from "jose";
import { bankingEnv } from "@/lib/env";
import { parseDecimalToMinor } from "@/lib/money";
import { normalizeEnableBanking, type EnableBankingTransaction } from "./normalize";
import { normalizePrivateKeyPem } from "./pem";
import {
  BankApiError,
  type BankProvider,
  type CompletedAuthorization,
  type Institution,
  type ProviderAccount,
  type RawTransactionPage,
} from "./types";

// Enable Banking API client. Verified against the official API reference
// (https://enablebanking.com/docs/api/reference/) on 2026-10-30:
//   * Base URL https://api.enablebanking.com
//   * Auth: RS256 JWT, header kid = application id, iss "enablebanking.com",
//     aud "api.enablebanking.com", max lifetime 24h.
//   * POST /auth -> { url }, POST /sessions { code } -> { session_id, accounts, access }
//   * GET /accounts/{uid}/transactions?date_from&date_to&continuation_key&strategy
//     -> { transactions, continuation_key }; keep paging while continuation_key is set.

const BASE_URL = "https://api.enablebanking.com";
const TOKEN_TTL_SECONDS = 3600;
const REQUEST_TIMEOUT_MS = 30_000;

let cachedKey: KeyObject | null = null;
let cachedToken: { value: string; expiresAt: number } | null = null;

function privateKey(): KeyObject {
  if (cachedKey) return cachedKey;
  // Pasting into a dashboard often mangles the line breaks; repair before parsing.
  cachedKey = createPrivateKey(normalizePrivateKeyPem(bankingEnv().ENABLE_BANKING_PRIVATE_KEY)); // PKCS#1 or PKCS#8
  return cachedKey;
}

async function token(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt - 60 > now) return cachedToken.value;
  const value = await new SignJWT({})
    .setProtectedHeader({ typ: "JWT", alg: "RS256", kid: bankingEnv().ENABLE_BANKING_APP_ID })
    .setIssuer("enablebanking.com")
    .setAudience("api.enablebanking.com")
    .setIssuedAt(now)
    .setExpirationTime(now + TOKEN_TTL_SECONDS)
    .sign(privateKey());
  cachedToken = { value, expiresAt: now + TOKEN_TTL_SECONDS };
  return value;
}

async function request<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${await token()}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (res.ok) return (await res.json()) as T;

  // Error bodies carry a machine-readable code; never log the body itself.
  let code = `HTTP_${res.status}`;
  let detail: string | undefined;
  try {
    const err = (await res.json()) as { error?: string; code?: string | number; message?: string; detail?: unknown };
    code = err.error || (typeof err.code === "string" ? err.code : undefined) || code;
    detail = err.message || (typeof err.detail === "string" ? err.detail : undefined);
  } catch {
    // non-JSON error body
  }
  throw new BankApiError(`Enable Banking ${method} ${path.split("?")[0]} failed`, code, res.status, detail);
}

type AspspResponse = {
  aspsps: {
    name: string;
    country: string;
    logo?: string | null;
    maximum_consent_validity?: number | null;
    beta?: boolean;
    psu_types?: string[];
  }[];
};

type SessionResponse = {
  session_id: string;
  access?: { valid_until?: string | null };
  accounts: {
    uid: string;
    identification_hash?: string | null;
    account_id?: { iban?: string | null; other?: { identification?: string | null } | null } | null;
    name?: string | null;
    details?: string | null;
    product?: string | null;
    currency?: string | null;
  }[];
};

type BalancesResponse = {
  balances: { balance_amount?: { amount?: string; currency?: string }; balance_type?: string }[];
};

function maskIban(iban: string | null | undefined): string | null {
  if (!iban) return null;
  const clean = iban.replace(/\s+/g, "");
  return clean.length > 4 ? `•••• ${clean.slice(-4)}` : null;
}

export const enableBanking: BankProvider = {
  id: "enable_banking",

  async listInstitutions(country) {
    const data = await request<AspspResponse>("GET", `/aspsps?country=${encodeURIComponent(country)}&psu_type=personal`);
    return data.aspsps.map(
      (a): Institution => ({
        name: a.name,
        country: a.country,
        logoUrl: a.logo ?? null,
        maxConsentSeconds: a.maximum_consent_validity ?? null,
        beta: a.beta ?? false,
      }),
    );
  },

  async startAuthorization({ institution, validUntil, state, redirectUrl }) {
    const data = await request<{ url: string }>("POST", "/auth", {
      access: { valid_until: validUntil.toISOString() },
      aspsp: { name: institution.name, country: institution.country },
      state,
      redirect_url: redirectUrl,
      psu_type: "personal",
    });
    return { url: data.url };
  },

  async completeAuthorization(code): Promise<CompletedAuthorization> {
    const data = await request<SessionResponse>("POST", "/sessions", { code });
    return {
      sessionId: data.session_id,
      validUntil: data.access?.valid_until ?? null,
      accounts: data.accounts.map(
        (a): ProviderAccount => ({
          uid: a.uid,
          // identification_hash is the documented cross-session identity.
          identity:
            a.identification_hash ??
            (a.account_id?.iban ? `iban:${createHash("sha256").update(a.account_id.iban.replace(/\s+/g, "")).digest("hex")}` : a.uid),
          name: (a.name || a.product || a.details || "Account").slice(0, 120),
          ibanMasked: maskIban(a.account_id?.iban ?? a.account_id?.other?.identification),
          currency: (a.currency ?? "NOK").toUpperCase(),
        }),
      ),
    };
  },

  async fetchTransactions({ accountUid, dateFrom, dateTo, continuationKey, strategy }): Promise<RawTransactionPage> {
    const params = new URLSearchParams({ date_from: dateFrom });
    if (dateTo && strategy !== "longest") params.set("date_to", dateTo);
    if (strategy === "longest") params.set("strategy", "longest");
    if (continuationKey) params.set("continuation_key", continuationKey);
    const data = await request<{ transactions?: unknown[]; continuation_key?: string | null }>(
      "GET",
      `/accounts/${encodeURIComponent(accountUid)}/transactions?${params}`,
    );
    return { transactions: data.transactions ?? [], continuationKey: data.continuation_key || null };
  },

  async fetchBalance({ accountUid }) {
    const data = await request<BalancesResponse>("GET", `/accounts/${encodeURIComponent(accountUid)}/balances`);
    // Prefer booked/available balances in a stable order.
    const order = ["CLBD", "ITBD", "ITAV", "CLAV", "XPCD", "OTHR"];
    const sorted = [...(data.balances ?? [])].sort(
      (a, b) => order.indexOf(a.balance_type ?? "OTHR") - order.indexOf(b.balance_type ?? "OTHR"),
    );
    const b = sorted[0]?.balance_amount;
    if (!b?.amount || !b.currency) return null;
    return { amountMinor: parseDecimalToMinor(b.amount, b.currency), currency: b.currency };
  },

  normalize(raw, accountCurrency) {
    return normalizeEnableBanking(raw as EnableBankingTransaction, accountCurrency);
  },

  async revoke(sessionId) {
    await request("DELETE", `/sessions/${encodeURIComponent(sessionId)}`);
  },
};
