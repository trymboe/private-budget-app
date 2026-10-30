import { describe, expect, it } from "vitest";
import { formatMoney, minorToDecimalString, parseDecimalToMinor, sumMinor } from "./money";

describe("parseDecimalToMinor", () => {
  it.each([
    ["459.00", 45900],
    ["459,5", 45950],
    ["-1 234,56", -123456],
    ["0.1", 10],
    ["12", 1200],
    ["+7.07", 707],
    ["−20,00", -2000],
    ["0.10", 10],
  ])("parses %s", (input, expected) => {
    expect(parseDecimalToMinor(input)).toBe(expected);
  });

  it("is exact where floats are not (0.1 + 0.2)", () => {
    expect(parseDecimalToMinor("0.1") + parseDecimalToMinor("0.2")).toBe(parseDecimalToMinor("0.3"));
  });

  it("rejects precision the currency cannot hold instead of rounding", () => {
    expect(() => parseDecimalToMinor("1.005")).toThrow(RangeError);
    expect(parseDecimalToMinor("1.500")).toBe(150);
  });

  it("handles zero-decimal currencies", () => {
    expect(parseDecimalToMinor("1500", "JPY")).toBe(1500);
    expect(() => parseDecimalToMinor("15.5", "JPY")).toThrow();
  });

  it("rejects garbage", () => {
    expect(() => parseDecimalToMinor("12a")).toThrow(SyntaxError);
    expect(() => parseDecimalToMinor("")).toThrow(SyntaxError);
  });
});

describe("formatting", () => {
  it("uses Norwegian conventions", () => {
    expect(formatMoney(123456).replace(/\s/g, " ")).toBe("1 234,56 kr");
    expect(formatMoney(120000).replace(/\s/g, " ")).toBe("1 200 kr");
    expect(formatMoney(-4550, "NOK", { decimals: "never" }).replace(/\s/g, " ")).toBe("−46 kr");
    expect(formatMoney(5000, "NOK", { signed: true }).replace(/\s/g, " ")).toBe("+50 kr");
  });

  it("formats exact decimal strings", () => {
    expect(minorToDecimalString(-5)).toBe("-0.05");
    expect(minorToDecimalString(900719925474099)).toBe("9007199254740.99");
  });

  it("refuses unsafe integers when summing", () => {
    expect(sumMinor([1, 2, 3])).toBe(6);
    expect(() => sumMinor([Number.MAX_SAFE_INTEGER, 1])).toThrow(RangeError);
  });
});
