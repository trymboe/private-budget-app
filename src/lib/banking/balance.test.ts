import { describe, expect, it } from "vitest";
import { balanceKind, pickBalance } from "./balance";

const b = (amount: string, type?: string, reference_date?: string, currency = "NOK") => ({
  balance_amount: { amount, currency },
  balance_type: type,
  reference_date,
});

describe("pickBalance", () => {
  it("prefers a booked balance over available and expected ones", () => {
    expect(pickBalance([b("15000.00", "ITAV"), b("12843.50", "CLBD", "2026-11-06"), b("12000", "XPCD")])).toEqual({
      amountMinor: 1_284_350,
      currency: "NOK",
      type: "CLBD",
      referenceDate: "2026-11-06",
    });
  });

  it("takes the most recent booked balance, and interim booked on a tie", () => {
    expect(pickBalance([b("100", "CLBD", "2026-11-06"), b("90", "ITBD", "2026-11-07")])?.type).toBe("ITBD");
    expect(pickBalance([b("100", "CLBD", "2026-11-07"), b("90", "ITBD", "2026-11-06")])?.type).toBe("CLBD");
    expect(pickBalance([b("100", "CLBD", "2026-11-07"), b("90", "ITBD", "2026-11-07")])?.type).toBe("ITBD");
    expect(pickBalance([b("100", "CLBD"), b("90", "ITBD", "2026-11-07")])?.type).toBe("ITBD");
  });

  it("falls back to available, then anything the bank reported", () => {
    expect(pickBalance([b("50", "XPCD"), b("60", "CLAV")])?.amountMinor).toBe(6_000);
    expect(pickBalance([b("70", "INFO")])).toEqual({ amountMinor: 7_000, currency: "NOK", type: "INFO", referenceDate: null });
    expect(pickBalance([b("70")])?.type).toBeNull();
  });

  it("keeps negative balances and other currencies exactly", () => {
    expect(pickBalance([b("-1250.75", "CLBD")])?.amountMinor).toBe(-125_075);
    expect(pickBalance([b("1000.10", "ITBD", undefined, "eur")])).toMatchObject({ amountMinor: 100_010, currency: "EUR" });
  });

  it("skips entries it cannot read instead of guessing", () => {
    expect(pickBalance([b("12.345", "CLBD"), b("abc", "ITBD"), b("10.00", "ITAV")])?.type).toBe("ITAV");
    expect(pickBalance([{ balance_amount: { amount: "10" } }, { balance_type: "CLBD" }])).toBeNull();
    expect(pickBalance([b("10", "CLBD", "not-a-date")])?.referenceDate).toBeNull();
    expect(pickBalance([b("10", "booked")])?.type).toBeNull();
    expect(pickBalance([])).toBeNull();
    expect(pickBalance(undefined)).toBeNull();
  });
});

describe("balanceKind", () => {
  it("names the balance types in plain words", () => {
    expect(balanceKind("CLBD")).toBe("booked");
    expect(balanceKind("ITAV")).toBe("available");
    expect(balanceKind("XPCD")).toBe("expected");
    expect(balanceKind("OTHR")).toBeNull();
    expect(balanceKind(null)).toBeNull();
  });
});
