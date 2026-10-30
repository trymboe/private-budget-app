// Mapping from Enable Banking's Transaction object to our normalized shape.
// Field names follow the Enable Banking API reference (verified 2026-10-30).
// The docs do not state whether `amount` is signed, so both forms are handled:
// the direction always comes from credit_debit_indicator when present.
import { createHash } from "node:crypto";
import { isIsoDate, type IsoDate } from "@/lib/dates";
import { normalizeMerchant } from "@/lib/merchant";
import { parseDecimalToMinor } from "@/lib/money";
import type { NormalizedTransaction } from "./types";

type Party = { name?: string | null } | null | undefined;
type Amount = { amount?: string | number | null; currency?: string | null } | null | undefined;

export type EnableBankingTransaction = {
  entry_reference?: string | null;
  transaction_id?: string | null;
  transaction_amount?: Amount;
  credit_debit_indicator?: "CRDT" | "DBIT" | string | null;
  status?: string | null;
  booking_date?: string | null;
  value_date?: string | null;
  transaction_date?: string | null;
  creditor?: Party;
  debtor?: Party;
  remittance_information?: string[] | string | null;
  merchant_category_code?: string | null;
  bank_transaction_code?: { description?: string | null; code?: string | null; sub_code?: string | null } | null;
  reference_number?: string | null;
  note?: string | null;
  exchange_rate?: {
    unit_currency?: string | null;
    exchange_rate?: string | null;
    source_currency?: string | null;
    target_currency?: string | null;
    instructed_amount?: Amount;
  } | null;
};

const STATUS_MAP: Record<string, "booked" | "pending" | null> = {
  BOOK: "booked",
  PDNG: "pending",
  HOLD: "pending",
  // Cancelled, rejected and scheduled (future) items are not spending.
  CNCL: null,
  RJCT: null,
  SCHD: null,
};

function date(value: string | null | undefined): IsoDate | null {
  if (!value) return null;
  const d = value.slice(0, 10);
  return isIsoDate(d) ? d : null;
}

function clean(value: string | null | undefined, max: number): string | null {
  if (!value) return null;
  const s = value.replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
}

export function fingerprintOf(parts: (string | number | null)[]): string {
  return createHash("sha256").update(parts.map((p) => (p === null ? "" : String(p))).join("\u001f")).digest("hex").slice(0, 40);
}

export function normalizeEnableBanking(raw: EnableBankingTransaction, accountCurrency: string): NormalizedTransaction | null {
  const statusCode = (raw.status ?? "BOOK").toUpperCase();
  const status = statusCode in STATUS_MAP ? STATUS_MAP[statusCode] : raw.booking_date ? "booked" : "pending";
  if (!status) return null;

  const amountRaw = raw.transaction_amount?.amount;
  const currency = (raw.transaction_amount?.currency ?? accountCurrency).toUpperCase();
  if (amountRaw === null || amountRaw === undefined || amountRaw === "") return null;
  let amountMinor = parseDecimalToMinor(String(amountRaw), currency);
  const indicator = raw.credit_debit_indicator?.toUpperCase();
  if (indicator === "DBIT") amountMinor = -Math.abs(amountMinor);
  else if (indicator === "CRDT") amountMinor = Math.abs(amountMinor);
  if (amountMinor === 0) return null;

  const bookingDate = date(raw.booking_date);
  const valueDate = date(raw.value_date);
  const transactionDate = date(raw.transaction_date);
  const effectiveDate =
    (status === "booked" ? bookingDate ?? transactionDate : transactionDate ?? bookingDate) ?? valueDate;
  if (!effectiveDate) return null;

  const remittance = Array.isArray(raw.remittance_information)
    ? raw.remittance_information.filter(Boolean).join(" · ")
    : raw.remittance_information ?? null;
  const party = amountMinor < 0 ? raw.creditor : raw.debtor;
  const counterparty = clean(party?.name, 300);
  const description = clean(remittance || raw.bank_transaction_code?.description || raw.note, 1000);

  // Foreign-currency purchase on a NOK account: keep the instructed amount.
  let originalAmountMinor: number | null = null;
  let originalCurrency: string | null = null;
  const instructed = raw.exchange_rate?.instructed_amount;
  if (instructed?.amount && instructed.currency && instructed.currency.toUpperCase() !== currency) {
    try {
      originalCurrency = instructed.currency.toUpperCase();
      originalAmountMinor = Math.sign(amountMinor) * Math.abs(parseDecimalToMinor(String(instructed.amount), originalCurrency));
    } catch {
      originalAmountMinor = null;
      originalCurrency = null;
    }
  }

  const providerRef = status === "booked" ? clean(raw.entry_reference, 200) : null;
  const textForKey = counterparty ?? description;
  const fingerprintBase = fingerprintOf([
    status,
    status === "booked" ? bookingDate ?? effectiveDate : effectiveDate,
    amountMinor,
    currency,
    (counterparty ?? "").toLowerCase(),
    (description ?? "").toLowerCase(),
  ]);

  return {
    providerRef,
    fingerprintBase,
    status,
    bookingDate,
    valueDate,
    transactionDate,
    effectiveDate,
    amountMinor,
    currency,
    originalAmountMinor,
    originalCurrency,
    counterparty,
    description,
    merchantKey: normalizeMerchant(textForKey),
    merchantCategoryCode: clean(raw.merchant_category_code, 8),
    bankMeta: {
      status: statusCode,
      entry_reference: raw.entry_reference ?? null,
      transaction_id: raw.transaction_id ?? null,
      bank_transaction_code: raw.bank_transaction_code ?? null,
      reference_number: raw.reference_number ?? null,
    },
  };
}

/**
 * Identical-looking transactions (two 39 kr coffees on the same day) share a
 * fingerprint base. The n-th occurrence within one fetch gets suffix n, which is
 * stable across repeated fetches of the same period.
 */
export function withOccurrence<T extends { fingerprintBase: string }>(items: T[]): (T & { fingerprint: string })[] {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const n = seen.get(item.fingerprintBase) ?? 0;
    seen.set(item.fingerprintBase, n + 1);
    return { ...item, fingerprint: `${item.fingerprintBase}:${n}` };
  });
}
