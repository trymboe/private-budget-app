import { describe, expect, it } from "vitest";
import { displayMerchant, normalizeMerchant } from "./merchant";

describe("normalizeMerchant", () => {
  it.each([
    ["VISA VARE 492500******1234 12.10 NOK 459,00 REMA 1000 MAJORSTUA Kurs: 1,0000", "rema 1000"],
    ["Rema 1000 Torshov", "rema 1000"],
    ["Vipps*Ruter AS", "ruter"],
    ["*1234 03.10 NOK 89.00 KIWI 123 GRUNERLOKKA Kurs: 1.0000", "kiwi grunerlokka"],
    ["Nettgiro til: Hafslund Strøm Betalt: 03.10.26", "hafslund strøm"],
    ["SPOTIFY AB", "spotify"],
    ["Netflix.com", "netflix.com"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeMerchant(input)).toBe(expected);
  });

  it("returns null for empty or pure-noise input", () => {
    expect(normalizeMerchant(null)).toBeNull();
    expect(normalizeMerchant("   ")).toBeNull();
    expect(normalizeMerchant("12.10 NOK 459,00")).toBeNull();
  });
});

describe("displayMerchant", () => {
  it("prefers a clean counterparty", () => {
    expect(displayMerchant("REMA 1000 MAJORSTUA", null)).toBe("Rema 1000 Majorstua");
    expect(displayMerchant("Oda", null)).toBe("Oda");
  });

  it("falls back to a tidied description", () => {
    expect(displayMerchant(null, "VISA VARE 492500******1234 12.10 NOK 459,00 REMA 1000 MAJORSTUA")).toBe("Rema 1000");
    expect(displayMerchant(null, null)).toBe("Unknown merchant");
  });
});
