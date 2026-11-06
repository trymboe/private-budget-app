// Small, strict CSV reader (RFC 4180 plus the variations spreadsheet apps produce):
// quoted fields with "" escapes and line breaks, CRLF or LF, a UTF-8 byte order
// mark, and comma, semicolon or tab as the delimiter (detected from the header).

export type CsvTable = { delimiter: string; header: string[]; rows: string[][] };

const DELIMITERS = [",", ";", "\t"] as const;

/** Pick the delimiter that splits the header line into the most columns. */
export function detectDelimiter(text: string): string {
  const firstLine = firstRecordLine(text);
  let best: string = ",";
  let bestCount = -1;
  for (const d of DELIMITERS) {
    const count = splitRecords(firstLine, d)[0]?.length ?? 0;
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

function firstRecordLine(text: string): string {
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (ch === "\n" || ch === "\r")) return text.slice(0, i);
  }
  return text;
}

function splitRecords(text: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && field === "") {
      inQuotes = true;
      i += 1;
    } else if (ch === delimiter) {
      record.push(field);
      field = "";
      i += 1;
    } else if (ch === "\r" || ch === "\n") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
      i += ch === "\r" && text[i + 1] === "\n" ? 2 : 1;
    } else {
      field += ch;
      i += 1;
    }
  }
  if (inQuotes) throw new SyntaxError("The file ends inside a quoted field. It may be cut off.");
  if (field !== "" || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records;
}

export function parseCsv(input: string): CsvTable {
  const text = input.replace(/^﻿/, "");
  const delimiter = detectDelimiter(text);
  const records = splitRecords(text, delimiter).filter((r) => !(r.length === 1 && r[0].trim() === ""));
  if (records.length === 0) throw new SyntaxError("The file is empty.");
  const [header, ...rows] = records;
  return { delimiter, header: header.map((h) => h.trim()), rows };
}
