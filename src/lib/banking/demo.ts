import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { addDays, diffDays, todayIn, type IsoDate } from "@/lib/dates";
import { serverEnv } from "@/lib/env";
import { normalizeEnableBanking, type EnableBankingTransaction } from "./normalize";
import type { BankProvider } from "./types";

// A fake bank for local development and demos, enabled only with
// ENABLE_DEMO_BANK=true. It produces realistic, deterministic Norwegian
// transactions in Enable Banking's response shape, so the whole connect -> import
// -> sync -> reconcile path runs without real credentials. Everything it creates
// is labelled "Demo" in the UI and stored with provider = 'demo'.

export const DEMO_INSTITUTION = "Demo Bank (not real)";
const PAGE_SIZE = 50;

type Merchant = { name: string; text: string; min: number; max: number; mcc?: string };

const GROCERIES: Merchant[] = [
  { name: "REMA 1000 MAJORSTUA", text: "VISA VARE 492500******1234 NOK REMA 1000 MAJORSTUA", min: 8_900, max: 64_000, mcc: "5411" },
  { name: "KIWI 345 BISLETT", text: "VISA VARE 492500******1234 NOK KIWI 345 BISLETT", min: 4_900, max: 41_000, mcc: "5411" },
  { name: "COOP EXTRA ULLEVÅL", text: "VISA VARE 492500******1234 NOK COOP EXTRA ULLEVÅL", min: 12_000, max: 89_000, mcc: "5411" },
  { name: "MENY STORO", text: "VISA VARE 492500******1234 NOK MENY STORO", min: 18_000, max: 120_000, mcc: "5411" },
];
const EATING_OUT: Merchant[] = [
  { name: "KAFFEBRENNERIET", text: "VISA VARE KAFFEBRENNERIET TORGGATA", min: 4_200, max: 9_800, mcc: "5814" },
  { name: "ESPRESSO HOUSE", text: "VISA VARE ESPRESSO HOUSE STORTINGSGT", min: 5_500, max: 11_900, mcc: "5814" },
  { name: "PEPPES PIZZA", text: "VISA VARE PEPPES PIZZA GRUNERLOKKA", min: 29_000, max: 68_000, mcc: "5812" },
  { name: "MATHALLEN OSLO", text: "VISA VARE MATHALLEN OSLO", min: 15_000, max: 52_000, mcc: "5812" },
];
const SHOPPING: Merchant[] = [
  { name: "ELKJØP STORO", text: "VISA VARE ELKJØP STORO", min: 19_900, max: 249_000, mcc: "5732" },
  { name: "CUBUS OSLO CITY", text: "VISA VARE CUBUS OSLO CITY", min: 14_900, max: 89_900, mcc: "5651" },
  { name: "CLAS OHLSON", text: "VISA VARE CLAS OHLSON KARL JOHAN", min: 4_900, max: 59_900, mcc: "5251" },
];
const OTHER: Merchant[] = [
  { name: "VINMONOPOLET", text: "VISA VARE VINMONOPOLET MAJORSTUEN", min: 21_900, max: 79_000, mcc: "5921" },
  { name: "APOTEK 1", text: "VISA VARE APOTEK 1 STORGATA", min: 8_900, max: 34_900, mcc: "5912" },
  { name: "NORLI", text: "VISA VARE NORLI UNIVERSITETSGATA", min: 19_900, max: 44_900, mcc: "5942" },
  { name: "ODEON KINO", text: "VISA VARE ODEON KINO OSLO", min: 14_000, max: 32_000, mcc: "7832" },
];

/** Small deterministic PRNG (mulberry32) seeded from a string. */
function rng(seed: string) {
  let a = createHash("sha256").update(seed).digest().readUInt32LE(0);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function amount(r: () => number, min: number, max: number) {
  // Whole kroner most of the time, like real card purchases; integers only.
  const kroner = Math.floor(min / 100 + r() * ((max - min) / 100));
  return kroner * 100 + (r() < 0.3 ? Math.floor(r() * 100) : 0);
}

function decimal(minor: number) {
  return `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, "0")}`;
}

type DemoAccount = "checking" | "savings";

function dayTransactions(account: DemoAccount, date: IsoDate, today: IsoDate): EnableBankingTransaction[] {
  const r = rng(`${account}:${date}`);
  const out: (Omit<EnableBankingTransaction, "status" | "booking_date" | "entry_reference"> & { minor: number })[] = [];
  const day = Number(date.slice(8, 10));
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  const debit = (m: Merchant, minor = amount(r, m.min, m.max)) =>
    out.push({
      minor,
      credit_debit_indicator: "DBIT",
      creditor: { name: m.name },
      remittance_information: [m.text],
      merchant_category_code: m.mcc ?? null,
    });

  if (account === "savings") {
    if (day === 26) {
      out.push({ minor: 500_000, credit_debit_indicator: "CRDT", debtor: { name: "Overføring fra brukskonto" }, remittance_information: ["Overføring"] });
    }
    if (day === 28 && date.slice(5, 7) === "12") {
      out.push({ minor: 31_250, credit_debit_indicator: "CRDT", debtor: { name: "Renter" }, remittance_information: ["Kreditrenter"] });
    }
  } else {
    if (day === 1) debit({ name: "OBOS EIENDOM", text: "Avtalegiro OBOS husleie", min: 1_295_000, max: 1_295_000 });
    if (day === 3) debit({ name: "RUTER AS", text: "Vipps*Ruter 30-dagersbillett", min: 85_300, max: 85_300 });
    if (day === 5) debit({ name: "SPOTIFY AB", text: "VISA VARE SPOTIFY AB STOCKHOLM", min: 13_900, max: 13_900 });
    if (day === 12) debit({ name: "NETFLIX.COM", text: "VISA VARE NETFLIX.COM", min: 17_900, max: 17_900 });
    if (day === 15) debit({ name: "HAFSLUND STRØM", text: "Nettgiro til: Hafslund Strøm", min: 42_000, max: 118_000 });
    if (day === 20) debit({ name: "SATS NORGE", text: "Avtalegiro SATS", min: 64_900, max: 64_900 });
    if (day === 25) {
      out.push({ minor: 4_235_000, credit_debit_indicator: "CRDT", debtor: { name: "ARBEIDSGIVER AS" }, remittance_information: ["Lønn"] });
    }
    if (day === 26) {
      out.push({ minor: 500_000, credit_debit_indicator: "DBIT", creditor: { name: "Overføring til sparekonto" }, remittance_information: ["Overføring"] });
    }
    // Groceries 3-4 times a week, more on weekends.
    if (r() < (dow === 6 || dow === 5 ? 0.85 : 0.45)) debit(GROCERIES[Math.floor(r() * GROCERIES.length)]);
    if (r() < 0.32) debit(EATING_OUT[Math.floor(r() * EATING_OUT.length)]);
    if (r() < 0.06) debit(SHOPPING[Math.floor(r() * SHOPPING.length)]);
    if (r() < 0.08) debit(OTHER[Math.floor(r() * OTHER.length)]);
    if (r() < 0.05) {
      // Splitting a bill with a friend over Vipps.
      out.push({
        minor: amount(r, 15_000, 45_000),
        credit_debit_indicator: r() < 0.5 ? "CRDT" : "DBIT",
        debtor: { name: "Kari Nordmann" },
        creditor: { name: "Kari Nordmann" },
        remittance_information: ["Vipps: middag"],
      });
    }
    if (r() < 0.012) {
      out.push({ minor: amount(r, 19_900, 59_900), credit_debit_indicator: "CRDT", debtor: { name: "ELKJØP STORO" }, remittance_information: ["Retur ELKJØP STORO"] });
    }
    if (r() < 0.01) {
      // A purchase abroad: NOK on the account, EUR originally.
      const eur = amount(r, 1_500, 9_000);
      out.push({
        minor: Math.round((eur * 1172) / 100),
        credit_debit_indicator: "DBIT",
        creditor: { name: "FNAC PARIS" },
        remittance_information: [`VISA VARE FNAC PARIS EUR ${decimal(eur)} Kurs: 11,72`],
        exchange_rate: { instructed_amount: { amount: decimal(eur), currency: "EUR" } },
      });
    }
  }

  // The last two days are still pending, like at a real bank.
  const pending = diffDays(today, date) <= 1;
  return out.map(({ minor, ...t }, i) => ({
    ...t,
    transaction_amount: { amount: decimal(minor), currency: "NOK" },
    status: pending ? "PDNG" : "BOOK",
    booking_date: pending ? null : date,
    value_date: date,
    transaction_date: date,
    entry_reference: pending ? null : `DEMO-${account}-${date}-${i}`,
  }));
}

export const demoBank: BankProvider = {
  id: "demo",

  async listInstitutions() {
    return [{ name: DEMO_INSTITUTION, country: "NO", logoUrl: null, maxConsentSeconds: 180 * 86_400, beta: false }];
  },

  async startAuthorization({ state }) {
    // No real bank: jump straight back to our callback with a fake code.
    const code = `demo-${randomBytes(12).toString("hex")}`;
    return { url: `${serverEnv().APP_URL}/api/bank/callback?state=${encodeURIComponent(state)}&code=${code}` };
  },

  async completeAuthorization(code) {
    return {
      sessionId: `demo-session-${code}`,
      validUntil: new Date(Date.now() + 180 * 86_400_000).toISOString(),
      accounts: [
        { uid: "demo-checking", identity: "demo-checking", name: "Brukskonto (demo)", ibanMasked: "•••• 1234", currency: "NOK" },
        { uid: "demo-savings", identity: "demo-savings", name: "Sparekonto (demo)", ibanMasked: "•••• 5678", currency: "NOK" },
      ],
    };
  },

  async fetchTransactions({ accountUid, dateFrom, dateTo, continuationKey }) {
    const today = todayIn();
    const account: DemoAccount = accountUid === "demo-savings" ? "savings" : "checking";
    // Like real banks, history is limited (here: 13 months).
    const earliest = addDays(today, -395);
    const from = dateFrom < earliest ? earliest : dateFrom;
    const to = dateTo && dateTo < today ? dateTo : today;
    const all: EnableBankingTransaction[] = [];
    for (let d = to; d >= from; d = addDays(d, -1)) all.push(...dayTransactions(account, d, today));
    const offset = continuationKey ? Number(continuationKey) : 0;
    const page = all.slice(offset, offset + PAGE_SIZE);
    return { transactions: page, continuationKey: offset + PAGE_SIZE < all.length ? String(offset + PAGE_SIZE) : null };
  },

  async fetchBalance({ accountUid }) {
    return { amountMinor: accountUid === "demo-savings" ? 8_450_000 : 1_284_350, currency: "NOK" };
  },

  normalize(raw, accountCurrency) {
    return normalizeEnableBanking(raw as EnableBankingTransaction, accountCurrency);
  },

  async revoke() {},
};
