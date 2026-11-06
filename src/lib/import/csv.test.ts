import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";

describe("parseCsv", () => {
  it("reads comma files with quotes, escaped quotes and line breaks", () => {
    const t = parseCsv('Date,Note\r\n2024-01-02,"Kaffe, ""stor""\nmed melk"\r\n2024-01-03,Brød\r\n');
    expect(t.header).toEqual(["Date", "Note"]);
    expect(t.rows).toEqual([
      ["2024-01-02", 'Kaffe, "stor"\nmed melk'],
      ["2024-01-03", "Brød"],
    ]);
  });

  it("detects semicolons and tabs and strips a byte order mark", () => {
    expect(parseCsv("﻿Dato;Beløp\n01.02.2024;-12,50").rows).toEqual([["01.02.2024", "-12,50"]]);
    expect(parseCsv("a\tb\n1\t2").header).toEqual(["a", "b"]);
  });

  it("ignores blank lines and rejects a file cut off inside quotes", () => {
    expect(parseCsv("a,b\n\n1,2\n\n").rows).toEqual([["1", "2"]]);
    expect(() => parseCsv('a,b\n1,"open')).toThrow(/cut off/);
  });
});
