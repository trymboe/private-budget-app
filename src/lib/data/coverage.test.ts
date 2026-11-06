import { describe, expect, it } from "vitest";
import { isMonthPartial } from "./coverage";
import type { AccountSummary, ConnectionSummary } from "./types";

function account(over: Partial<AccountSummary>): AccountSummary {
  return {
    id: Math.random().toString(),
    name: "x",
    ibanMasked: null,
    currency: "NOK",
    isSynced: true,
    includeInBudget: true,
    historyRequestedFrom: null,
    historyAvailableFrom: null,
    historyLimited: false,
    initialImportCompletedAt: "2026-01-01T00:00:00Z",
    lastSyncedAt: null,
    balanceMinor: null,
    provider: "enable_banking",
    importedThrough: null,
    spaceId: "s",
    isMine: true,
    ...over,
  };
}

const conn = (...accounts: AccountSummary[]) => [{ id: "c", accounts } as unknown as ConnectionSummary];

describe("isMonthPartial with imported history", () => {
  const bank = account({ historyAvailableFrom: "2025-11-04", historyRequestedFrom: "2025-11-01" });

  it("marks months before the bank's history as partial without an import", () => {
    expect(isMonthPartial(conn(bank), "2025-10-01")).toBe(true);
    expect(isMonthPartial(conn(bank), "2025-12-01")).toBe(false);
  });

  it("treats months covered by imported history as complete", () => {
    const buddy = account({ provider: "manual", historyAvailableFrom: "2019-03-14", importedThrough: "2025-11-03" });
    expect(isMonthPartial(conn(bank, buddy), "2025-10-01")).toBe(false);
    expect(isMonthPartial(conn(bank, buddy), "2025-11-01")).toBe(false);
    expect(isMonthPartial(conn(bank, buddy), "2020-05-01")).toBe(false);
    // The month the import starts in is partial; so are months before it.
    expect(isMonthPartial(conn(bank, buddy), "2019-03-01")).toBe(true);
    expect(isMonthPartial(conn(bank, buddy), "2019-01-01")).toBe(true);
  });

  it("keeps a gap between the import and the bank partial", () => {
    const buddy = account({ provider: "manual", historyAvailableFrom: "2019-03-14", importedThrough: "2025-09-20" });
    expect(isMonthPartial(conn(bank, buddy), "2025-08-01")).toBe(false);
    expect(isMonthPartial(conn(bank, buddy), "2025-09-01")).toBe(true);
    expect(isMonthPartial(conn(bank, buddy), "2025-10-01")).toBe(true);
  });
});
