import { describe, expect, it } from "vitest";
import { formatAge, summarizeBalances } from "./balances";
import type { AccountSummary, ConnectionSummary } from "./data/types";

const NOW = new Date("2026-11-07T12:00:00Z");

function account(over: Partial<AccountSummary> & { id: string }): AccountSummary {
  return {
    name: over.id,
    ibanMasked: null,
    currency: "NOK",
    isSynced: true,
    includeInBudget: true,
    historyRequestedFrom: null,
    historyAvailableFrom: null,
    historyLimited: false,
    initialImportCompletedAt: "2026-10-01T00:00:00Z",
    lastSyncedAt: "2026-11-07T06:00:00Z",
    balanceMinor: 100_000,
    balanceAt: "2026-11-07T06:00:00Z",
    balanceType: "CLBD",
    balanceReferenceDate: "2026-11-07",
    provider: "enable_banking",
    spaceId: "space",
    isMine: true,
    ...over,
  };
}

function connection(accounts: AccountSummary[], over: Partial<ConnectionSummary> = {}): ConnectionSummary {
  return {
    id: "conn",
    isMine: true,
    provider: "enable_banking",
    institutionName: "Handelsbanken",
    status: "active",
    consentValidUntil: null,
    lastSyncedAt: null,
    lastSyncError: null,
    rateLimitedUntil: null,
    accounts,
    ...over,
  };
}

describe("summarizeBalances", () => {
  it("adds NOK balances, grouped by whether the account counts toward the budget", () => {
    const o = summarizeBalances(
      [
        connection([
          account({ id: "checking", balanceMinor: 1_284_350 }),
          account({ id: "savings", balanceMinor: 8_450_000, includeInBudget: false, balanceType: "ITAV" }),
          account({ id: "card", balanceMinor: -250_075 }),
        ]),
      ],
      NOW,
    )!;
    expect(o.budget.lines.map((l) => l.id)).toEqual(["checking", "card"]);
    expect(o.budget.total).toBe(1_034_275);
    expect(o.other.lines.map((l) => l.id)).toEqual(["savings"]);
    expect(o.other.total).toBe(8_450_000);
    expect(o.total).toBe(9_484_275);
    expect(o.counted).toBe(3);
    expect(o.other.lines[0].kind).toBe("available");
    expect(o.budget.lines[0].kind).toBe("booked");
  });

  it("lists other currencies and missing balances without adding them", () => {
    const o = summarizeBalances(
      [
        connection([
          account({ id: "nok", balanceMinor: 100_000 }),
          account({ id: "eur", currency: "EUR", balanceMinor: 50_000 }),
          account({ id: "new", balanceMinor: null, balanceAt: null, balanceType: null }),
        ]),
      ],
      NOW,
    )!;
    expect(o.total).toBe(100_000);
    expect(o.counted).toBe(1);
    expect(o.foreign).toBe(1);
    expect(o.missing).toBe(1);
    expect(o.budget.lines).toHaveLength(3);
    expect(o.budget.lines[2]).toMatchObject({ balanceMinor: null, kind: null, stale: false });
  });

  it("says how old the oldest counted reading is, and flags stale ones", () => {
    const o = summarizeBalances(
      [
        connection([account({ id: "fresh", balanceAt: "2026-11-07T11:00:00Z" }), account({ id: "old", balanceAt: "2026-11-04T06:00:00Z" })]),
        connection([account({ id: "expired", balanceAt: "2026-11-07T10:00:00Z" })], { id: "c2", status: "expired" }),
      ],
      NOW,
    )!;
    expect(o.oldestAt).toBe("2026-11-04T06:00:00Z");
    expect(o.newestAt).toBe("2026-11-07T11:00:00Z");
    expect(o.budget.lines.map((l) => [l.id, l.stale, l.connectionEnded])).toEqual([
      ["fresh", false, false],
      ["old", true, false],
      ["expired", true, true],
    ]);
    expect(o.stale).toBe(2);
  });

  it("notes the bank's own date when the balance applies to an earlier day", () => {
    const o = summarizeBalances(
      [connection([account({ id: "a", balanceReferenceDate: "2026-11-06" }), account({ id: "b", balanceReferenceDate: null })])],
      NOW,
    )!;
    expect(o.budget.lines.map((l) => l.asOf)).toEqual(["2026-11-06", null]);
  });

  it("leaves out accounts that are not imported and hand-entered accounts without a balance", () => {
    expect(
      summarizeBalances(
        [
          connection([account({ id: "skipped", isSynced: false })]),
          connection([account({ id: "cash", provider: "manual", balanceMinor: null, balanceAt: null })], { id: "manual" }),
        ],
        NOW,
      ),
    ).toBeNull();
    expect(summarizeBalances([], NOW)).toBeNull();
  });
});

describe("formatAge", () => {
  it("is coarse and plain", () => {
    expect(formatAge("2026-11-07T11:59:40Z", NOW)).toBe("just now");
    expect(formatAge("2026-11-07T11:48:00Z", NOW)).toBe("12 min ago");
    expect(formatAge("2026-11-07T09:00:00Z", NOW)).toBe("3 h ago");
    expect(formatAge("2026-11-06T09:00:00Z", NOW)).toBe("1 day ago");
    expect(formatAge("2026-11-03T09:00:00Z", NOW)).toBe("4 days ago");
    expect(formatAge("2026-10-01T09:00:00Z", NOW)).toBe("on 1 Oct");
    expect(formatAge("2025-10-01T09:00:00Z", NOW)).toBe("on 1 Oct 2025");
  });
});
