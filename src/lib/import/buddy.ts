// Reader for Buddy's export. Column names are matched case-insensitively against
// the names Buddy uses, so a re-ordered or extra column never shifts the data.
// Every row must parse completely, otherwise the whole file is rejected with the
// line number: an import never guesses.
import { isIsoDate, type IsoDate } from "@/lib/dates";
import { parseDecimalToMinor } from "@/lib/money";
import { parseCsv } from "./csv";
import type { ImportRow } from "./plan";

export const BUDDY_SOURCE = "buddy";

// TODO(format): pinned to Buddy's real export once a sample file is available.
const COLUMNS = {
  date: ["date", "dato"],
  amount: ["amount", "beløp", "belop"],
  category: ["category", "kategori"],
  description: ["description", "beskrivelse", "title", "tittel", "name", "navn"],
  note: ["note", "notat", "comment", "kommentar"],
  currency: ["currency", "valuta"],
  kind: ["type"],
} as const;

export class ImportFormatError extends Error {}

function columnIndex(header: string[], names: readonly string[]): number {
  const lower = header.map((h) => h.trim().toLocaleLowerCase("nb-NO"));
  return lower.findIndex((h) => names.includes(h));
}

function parseDate(value: string, line: number): IsoDate {
  const v = value.trim();
  if (isIsoDate(v.slice(0, 10)) && (v.length === 10 || /^[T ]/.test(v.slice(10)))) return v.slice(0, 10) as IsoDate;
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(v);
  if (m) {
    const iso = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    if (isIsoDate(iso)) return iso as IsoDate;
  }
  throw new ImportFormatError(`Line ${line}: "${value}" is not a date I can read.`);
}

export function parseBuddyExport(text: string): ImportRow[] {
  let table;
  try {
    table = parseCsv(text);
  } catch (e) {
    throw new ImportFormatError(e instanceof Error ? e.message : "The file could not be read.");
  }
  const idx = Object.fromEntries(
    Object.entries(COLUMNS).map(([k, names]) => [k, columnIndex(table.header, names)]),
  ) as Record<keyof typeof COLUMNS, number>;
  if (idx.date < 0 || idx.amount < 0) {
    throw new ImportFormatError("This does not look like a Buddy export: it has no date and amount columns.");
  }
  const cell = (row: string[], i: number) => (i >= 0 ? (row[i] ?? "").trim() : "");

  return table.rows.map((row, i) => {
    const line = i + 2;
    if (row.length < table.header.length && row.every((c) => c.trim() === "")) {
      throw new ImportFormatError(`Line ${line} is empty.`);
    }
    let amountMinor: number;
    const currency = (cell(row, idx.currency) || "NOK").toUpperCase();
    try {
      amountMinor = parseDecimalToMinor(cell(row, idx.amount), currency);
    } catch {
      throw new ImportFormatError(`Line ${line}: "${cell(row, idx.amount)}" is not an amount I can read.`);
    }
    const kindText = cell(row, idx.kind).toLocaleLowerCase("nb-NO");
    const kind = /^(income|inntekt)/.test(kindText) ? "income" : /^(expense|utgift)/.test(kindText) ? "expense" : null;
    return {
      line,
      date: parseDate(cell(row, idx.date), line),
      amountMinor,
      currency,
      category: cell(row, idx.category) || null,
      kind,
      description: cell(row, idx.description).slice(0, 300) || null,
      note: cell(row, idx.note).slice(0, 1000) || null,
    };
  });
}
