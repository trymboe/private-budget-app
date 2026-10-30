// Calendar helpers. Bank dates are plain calendar dates ("YYYY-MM-DD") with no
// time zone. "Today" is computed in the user's time zone (Europe/Oslo by default)
// so a purchase at 00:30 Oslo time lands in the right month.

export type IsoDate = string; // YYYY-MM-DD

export const DEFAULT_TIME_ZONE = "Europe/Oslo";

export function todayIn(timeZone = DEFAULT_TIME_ZONE, now: Date = new Date()): IsoDate {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function isIsoDate(value: string): value is IsoDate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function toUtc(date: IsoDate): Date {
  return new Date(`${date}T00:00:00Z`);
}

function fromUtc(d: Date): IsoDate {
  return d.toISOString().slice(0, 10);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const d = toUtc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUtc(d);
}

export function diffDays(a: IsoDate, b: IsoDate): number {
  return Math.round((toUtc(a).getTime() - toUtc(b).getTime()) / 86_400_000);
}

export function monthStart(date: IsoDate): IsoDate {
  return `${date.slice(0, 7)}-01`;
}

export function addMonths(month: IsoDate, n: number): IsoDate {
  const d = toUtc(monthStart(month));
  d.setUTCMonth(d.getUTCMonth() + n);
  return fromUtc(d);
}

export function monthEnd(date: IsoDate): IsoDate {
  return addDays(addMonths(monthStart(date), 1), -1);
}

export function daysInMonth(date: IsoDate): number {
  return Number(monthEnd(date).slice(8, 10));
}

/** ISO week starts on Monday (Norwegian convention). */
export function weekStart(date: IsoDate): IsoDate {
  const dow = (toUtc(date).getUTCDay() + 6) % 7; // 0 = Monday
  return addDays(date, -dow);
}

export function isValidMonthParam(value: string | undefined | null): value is string {
  return !!value && /^\d{4}-\d{2}$/.test(value) && isIsoDate(`${value}-01`);
}

export function minDate(a: IsoDate, b: IsoDate): IsoDate {
  return a < b ? a : b;
}

export function maxDate(a: IsoDate, b: IsoDate): IsoDate {
  return a > b ? a : b;
}

const monthFormatters = new Map<string, Intl.DateTimeFormat>();

export function formatMonth(month: IsoDate, opts: { year?: boolean; short?: boolean; locale?: string } = {}): string {
  const { year = false, short = false, locale = "en-GB" } = opts;
  const key = `${locale}|${year}|${short}`;
  let f = monthFormatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, {
      month: short ? "short" : "long",
      year: year ? "numeric" : undefined,
      timeZone: "UTC",
    });
    monthFormatters.set(key, f);
  }
  return f.format(toUtc(monthStart(month)));
}

export function formatDay(date: IsoDate, today: IsoDate, locale = "en-GB"): string {
  const diff = diffDays(today, date);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  const sameYear = date.slice(0, 4) === today.slice(0, 4);
  return new Intl.DateTimeFormat(locale, {
    weekday: diff < 7 && diff > 0 ? "long" : undefined,
    day: "numeric",
    month: "long",
    year: sameYear ? undefined : "numeric",
    timeZone: "UTC",
  }).format(toUtc(date));
}

export function formatShortDate(date: IsoDate, locale = "en-GB"): string {
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }).format(toUtc(date));
}
