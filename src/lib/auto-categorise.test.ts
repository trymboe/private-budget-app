import { describe, expect, it } from "vitest";
import { AUTO_THRESHOLD, confirmationsToGo, countByMerchant, describeRuleChange, firstRuleChange, isAutomatic, type RuleState } from "./auto-categorise";

const rule = (patch: Partial<RuleState> = {}): RuleState => ({
  id: "r1",
  merchantKey: "rema 1000",
  categoryId: "groceries",
  confirmations: 1,
  autoEnabled: true,
  ...patch,
});

describe("isAutomatic", () => {
  it("needs the threshold, the merchant switch and the space switch", () => {
    expect(AUTO_THRESHOLD).toBe(3);
    expect(isAutomatic(rule({ confirmations: 2 }), true)).toBe(false);
    expect(isAutomatic(rule({ confirmations: 3 }), true)).toBe(true);
    expect(isAutomatic(rule({ confirmations: 9 }), true)).toBe(true);
    expect(isAutomatic(rule({ confirmations: 9, autoEnabled: false }), true)).toBe(false);
    expect(isAutomatic(rule({ confirmations: 9 }), false)).toBe(false);
    expect(isAutomatic(null, true)).toBe(false);
  });

  it("counts down to automatic", () => {
    expect(confirmationsToGo(0)).toBe(3);
    expect(confirmationsToGo(2)).toBe(1);
    expect(confirmationsToGo(7)).toBe(0);
  });
});

describe("describeRuleChange", () => {
  it("reports when a merchant becomes automatic", () => {
    expect(describeRuleChange(rule({ confirmations: 2 }), rule({ confirmations: 3 }), true)).toEqual({
      kind: "now_auto",
      ruleId: "r1",
      merchantKey: "rema 1000",
      categoryId: "groceries",
    });
    // A brand-new rule from a bulk categorisation of three transactions.
    expect(describeRuleChange(null, rule({ confirmations: 3 }), true)?.kind).toBe("now_auto");
  });

  it("says nothing while it stays the same", () => {
    expect(describeRuleChange(rule({ confirmations: 1 }), rule({ confirmations: 2 }), true)).toBeNull();
    expect(describeRuleChange(rule({ confirmations: 4 }), rule({ confirmations: 5 }), true)).toBeNull();
    expect(describeRuleChange(rule(), null, true)).toBeNull();
  });

  it("stays quiet when automatic filing is off for the space or the merchant", () => {
    expect(describeRuleChange(rule({ confirmations: 2 }), rule({ confirmations: 3 }), false)).toBeNull();
    expect(describeRuleChange(rule({ confirmations: 2, autoEnabled: false }), rule({ confirmations: 3, autoEnabled: false }), true)).toBeNull();
  });

  it("reports a correction that resets a trusted merchant, with the rule to restore", () => {
    expect(describeRuleChange(rule({ confirmations: 6 }), rule({ categoryId: "gifts", confirmations: 1 }), true)).toEqual({
      kind: "no_longer_auto",
      ruleId: "r1",
      merchantKey: "rema 1000",
      categoryId: "gifts",
      previous: { categoryId: "groceries", confirmations: 6 },
    });
  });

  it("picks the first change across merchants", () => {
    const before = new Map([["kiwi", rule({ merchantKey: "kiwi", confirmations: 5 })]]);
    const after = new Map([
      ["kiwi", rule({ merchantKey: "kiwi", confirmations: 6 })],
      ["rema 1000", rule({ confirmations: 3 })],
    ]);
    expect(firstRuleChange(before, after, ["kiwi", "rema 1000", "kiwi"], true)?.merchantKey).toBe("rema 1000");
    expect(firstRuleChange(before, after, ["kiwi"], true)).toBeNull();
  });
});

describe("countByMerchant", () => {
  it("counts per merchant and skips unknown merchants", () => {
    const counts = countByMerchant([{ merchantKey: "kiwi" }, { merchantKey: "kiwi" }, { merchantKey: null }, { merchantKey: "rema 1000" }]);
    expect([...counts]).toEqual([
      ["kiwi", 2],
      ["rema 1000", 1],
    ]);
  });
});
