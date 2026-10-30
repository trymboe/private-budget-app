// Turns noisy bank text into a short, stable merchant key used for learning
// category suggestions. Norwegian bank descriptions typically look like
//   "VISA VARE 492500******1234 12.10 NOK 459,00 REMA 1000 MAJORSTUA Kurs: 1,0000"
//   "Vipps*Ruter AS" / "Nettgiro til: Hafslund Strøm Betalt: 03.10.26"
// The key keeps the first two meaningful words ("rema 1000", "ruter").

const NOISE_PATTERNS: RegExp[] = [
  /\bkurs:?\s*[\d.,]+/g, // exchange rate tail
  /\b(?:nok|eur|usd|sek|dkk|gbp)\s*-?[\d\s.,]+(?=\s|$)/g, // amount echoes
  /\b\d{4,6}[*x]{2,}\d{0,4}\b/g, // masked card numbers
  /\*{1,}\d{2,}/g, // *1234
  /\b\d{1,2}\.\d{1,2}(?:\.\d{2,4})?\b/g, // dates 12.10 / 12.10.26
  /\b\d{1,2}:\d{2}\b/g, // times
  /\bbetalt:?.*$/g, // "Betalt: 03.10.26" and everything after
  /\b(?:visa|mastercard|maestro|bankaxept)\s+(?:vare|varekjøp|kjøp)?\b/g,
  /\b(?:varekjøp|kortkjøp|kjøp|vare|nettgiro|giro|efaktura|avtalegiro|reservasjon|reservert|overføring)\b/g,
  /\b(?:til|fra):/g,
  /^(?:vipps|vipps\s+by|paypal|sumup|izettle|zettle|sq|klarna)\s*[*:]\s*/g,
];

const SUFFIXES = new Set(["as", "asa", "ab", "aps", "ltd", "inc", "gmbh", "sa", "ba", "da", "nuf"]);

export function normalizeMerchant(input: string | null | undefined): string | null {
  if (!input) return null;
  let s = input.toLowerCase().normalize("NFKC").replace(/\s+/g, " ").trim();
  for (const p of NOISE_PATTERNS) s = s.replace(p, " ");
  const tokens = s
    .replace(/[^\p{L}\p{N}&.\-/ ]/gu, " ")
    .split(" ")
    .map((t) => t.replace(/^[.\-/]+|[.\-/]+$/g, ""))
    .filter(Boolean)
    // Long digit runs are references or store ids; four-digit tokens are often
    // part of a brand ("Rema 1000", "Kiwi 7-Eleven"), so keep those.
    .filter((t) => !/^\d+$/.test(t) || t.length === 4)
    .filter((t) => !SUFFIXES.has(t));
  if (tokens.length === 0) return null;
  return tokens.slice(0, 2).join(" ").slice(0, 120);
}

/** Display-friendly merchant name: prefer the bank's counterparty, tidied. */
export function displayMerchant(counterparty: string | null, description: string | null): string {
  const raw = (counterparty || description || "").trim();
  if (!raw) return "Unknown merchant";
  const key = normalizeMerchant(raw);
  // If the counterparty is already a clean name, keep its original casing.
  if (counterparty && counterparty.length <= 40 && !/\d{5,}/.test(counterparty)) {
    return titleCase(counterparty.replace(/\s+/g, " ").trim());
  }
  return key ? titleCase(key) : raw.slice(0, 40);
}

function titleCase(s: string): string {
  if (s !== s.toUpperCase() && s !== s.toLowerCase()) return s; // already mixed case
  return s
    .toLowerCase()
    .replace(/(^|[\s\-/&])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase())
    .replace(/\b(As|Asa|Ab|Aps|Ba|Da|Nuf)$/u, (m) => m.toUpperCase());
}
