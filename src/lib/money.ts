// Money is always an integer number of minor units (øre for NOK). Arithmetic on
// integers below 2^53 is exact in JavaScript; anything else is rejected. Parsing and
// formatting go through strings so a float never touches a monetary value.

export type Minor = number;

const DEFAULT_LOCALE = "nb-NO";

export function minorUnitDigits(currency: string): number {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

export function assertMinor(value: number): Minor {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`Not a safe integer amount: ${value}`);
  }
  return value;
}

export function sumMinor(values: Iterable<Minor>): Minor {
  let total = 0;
  for (const v of values) total = assertMinor(total + assertMinor(v));
  return total;
}

/**
 * Parse a decimal string ("-1234.5", "1 234,50", "12") into minor units.
 * Accepts '.' or ',' as decimal separator and spaces/apostrophes as grouping.
 * Rejects more fraction digits than the currency allows rather than rounding.
 */
export function parseDecimalToMinor(input: string, currency = "NOK"): Minor {
  const digits = minorUnitDigits(currency);
  const cleaned = input
    .trim()
    .replace(/[\s  ']/g, "")
    .replace(/^\+/, "")
    .replace(/[−–]/g, "-");
  const match = /^(-)?(\d+)(?:[.,](\d+))?$/.exec(cleaned);
  if (!match) throw new SyntaxError(`Invalid amount: "${input}"`);
  const [, sign, whole, fraction = ""] = match;
  const trimmedFraction = fraction.replace(/0+$/, "");
  if (trimmedFraction.length > digits) {
    throw new RangeError(`Too many decimals for ${currency}: "${input}"`);
  }
  const minorString = whole + fraction.slice(0, digits).padEnd(digits, "0");
  const value = Number(minorString.replace(/^0+(?=\d)/, ""));
  return assertMinor(sign && value !== 0 ? -value : value);
}

/** Exact decimal string for a minor amount, e.g. -123456 -> "-1234.56". */
export function minorToDecimalString(minor: Minor, currency = "NOK"): string {
  assertMinor(minor);
  const digits = minorUnitDigits(currency);
  const negative = minor < 0;
  const abs = String(Math.abs(minor)).padStart(digits + 1, "0");
  const whole = digits === 0 ? abs : abs.slice(0, -digits);
  const fraction = digits === 0 ? "" : abs.slice(-digits);
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

type FormatOptions = {
  locale?: string;
  /** Show øre. Default: only when the amount is not whole. */
  decimals?: "auto" | "always" | "never";
  /** Prefix positive amounts with '+'. */
  signed?: boolean;
  /** Drop the currency symbol (for dense tables). */
  bare?: boolean;
};

const formatterCache = new Map<string, Intl.NumberFormat>();

function formatter(locale: string, currency: string, fractionDigits: number, signed: boolean, bare: boolean) {
  const key = [locale, currency, fractionDigits, signed, bare].join("|");
  let f = formatterCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, {
      style: bare ? "decimal" : "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
      signDisplay: signed ? "exceptZero" : "auto",
    });
    formatterCache.set(key, f);
  }
  return f;
}

/**
 * Format minor units for display using Norwegian conventions by default:
 * formatMoney(123456) -> "1 234,56 kr". Formatting is fed an exact decimal
 * string (Intl supports string input), so no float conversion happens.
 */
export function formatMoney(minor: Minor, currency = "NOK", options: FormatOptions = {}): string {
  const { locale = DEFAULT_LOCALE, decimals = "auto", signed = false, bare = false } = options;
  const digits = minorUnitDigits(currency);
  const unit = 10 ** digits;
  let fractionDigits = digits;
  let value = minor;
  if (decimals === "never") {
    fractionDigits = 0;
    // Round half away from zero on integers, never on floats.
    const remainder = Math.abs(minor) % unit;
    const wholeUnits = (Math.abs(minor) - remainder) / unit + (remainder * 2 >= unit ? 1 : 0);
    value = (minor < 0 ? -wholeUnits : wholeUnits) * unit;
  } else if (decimals === "auto" && minor % unit === 0) {
    fractionDigits = 0;
  }
  const decimal = minorToDecimalString(value, currency);
  return formatter(locale, currency, fractionDigits, signed, bare).format(decimal as unknown as number);
}

/** Integer percentage (0-100+) of part/whole, rounded half up, without floats in money. */
export function ratioPercent(part: Minor, whole: Minor): number {
  if (whole <= 0) return part > 0 ? 100 : 0;
  return Math.round((part * 100) / whole);
}
