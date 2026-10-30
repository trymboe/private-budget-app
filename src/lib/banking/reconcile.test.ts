import { describe, expect, it } from "vitest";
import { normalizeEnableBanking, withOccurrence, type EnableBankingTransaction } from "./normalize";
import { reconcile, type IncomingTransaction, type StoredTransaction } from "./reconcile";

const window = { from: "2026-10-01", to: "2026-10-31" };

function raw(overrides: Partial<EnableBankingTransaction> = {}): EnableBankingTransaction {
  return {
    entry_reference: "REF-1",
    transaction_amount: { amount: "459.00", currency: "NOK" },
    credit_debit_indicator: "DBIT",
    status: "BOOK",
    booking_date: "2026-10-12",
    value_date: "2026-10-12",
    transaction_date: "2026-10-11",
    creditor: { name: "REMA 1000 MAJORSTUA" },
    remittance_information: ["VISA VARE 492500******1234 11.10 NOK 459,00 REMA 1000 MAJORSTUA"],
    ...overrides,
  };
}

function incoming(...items: EnableBankingTransaction[]): IncomingTransaction[] {
  return withOccurrence(items.map((i) => normalizeEnableBanking(i, "NOK")!).filter(Boolean));
}

function asStored(tx: IncomingTransaction, id: string, extra: Partial<StoredTransaction> = {}): StoredTransaction {
  return {
    id,
    providerRef: tx.providerRef,
    fingerprint: tx.fingerprint,
    status: tx.status,
    effectiveDate: tx.effectiveDate,
    amountMinor: tx.amountMinor,
    currency: tx.currency,
    merchantKey: tx.merchantKey,
    removedAt: null,
    ...extra,
  };
}

describe("normalizeEnableBanking", () => {
  it("derives sign from credit_debit_indicator whether or not amount is signed", () => {
    expect(normalizeEnableBanking(raw(), "NOK")!.amountMinor).toBe(-45900);
    expect(normalizeEnableBanking(raw({ transaction_amount: { amount: "-459.00", currency: "NOK" } }), "NOK")!.amountMinor).toBe(-45900);
    expect(
      normalizeEnableBanking(raw({ credit_debit_indicator: "CRDT", debtor: { name: "Arbeidsgiver AS" } }), "NOK")!.amountMinor,
    ).toBe(45900);
  });

  it("uses the debtor as counterparty for incoming money", () => {
    const tx = normalizeEnableBanking(raw({ credit_debit_indicator: "CRDT", debtor: { name: "Ola Nordmann" } }), "NOK")!;
    expect(tx.counterparty).toBe("Ola Nordmann");
  });

  it("copes with missing merchant metadata", () => {
    const tx = normalizeEnableBanking(
      raw({ creditor: null, remittance_information: null, bank_transaction_code: { description: "Varekjøp" } }),
      "NOK",
    )!;
    expect(tx.counterparty).toBeNull();
    expect(tx.description).toBe("Varekjøp");
    expect(tx.merchantKey).toBeNull();
  });

  it("drops cancelled and scheduled items, and pending items have no provider ref", () => {
    expect(normalizeEnableBanking(raw({ status: "CNCL" }), "NOK")).toBeNull();
    expect(normalizeEnableBanking(raw({ status: "SCHD" }), "NOK")).toBeNull();
    const pending = normalizeEnableBanking(raw({ status: "PDNG", booking_date: null }), "NOK")!;
    expect(pending.status).toBe("pending");
    expect(pending.providerRef).toBeNull();
    expect(pending.effectiveDate).toBe("2026-10-11");
  });
});

describe("reconcile", () => {
  it("is idempotent: syncing the same data twice changes nothing", () => {
    const first = incoming(raw(), raw({ entry_reference: "REF-2", transaction_amount: { amount: "89.00", currency: "NOK" } }));
    const stored = first.map((t, i) => asStored(t, `id-${i}`));
    const plan = reconcile(stored, incoming(raw(), raw({ entry_reference: "REF-2", transaction_amount: { amount: "89.00", currency: "NOK" } })), window);
    expect(plan.inserts).toHaveLength(0);
    expect(plan.removals).toHaveLength(0);
    expect(plan.unchanged).toBe(2);
  });

  it("keeps two identical purchases on the same day as two transactions", () => {
    const coffee = raw({ entry_reference: null, transaction_amount: { amount: "39.00", currency: "NOK" }, creditor: { name: "Kaffebrenneriet" } });
    const plan = reconcile([], incoming(coffee, coffee), window);
    expect(plan.inserts).toHaveLength(2);
    expect(new Set(plan.inserts.map((t) => t.fingerprint)).size).toBe(2);

    const stored = plan.inserts.map((t, i) => asStored(t, `c-${i}`));
    const again = reconcile(stored, incoming(coffee, coffee), window);
    expect(again.inserts).toHaveLength(0);
    expect(again.unchanged).toBe(2);
  });

  it("promotes a pending transaction to booked, keeping its id (and so its category)", () => {
    const pending = incoming(raw({ status: "PDNG", entry_reference: null, booking_date: null }));
    const stored = [asStored(pending[0], "pending-1")];
    const plan = reconcile(stored, incoming(raw({ entry_reference: "BOOKED-77" })), window);
    expect(plan.inserts).toHaveLength(0);
    expect(plan.updates).toEqual([expect.objectContaining({ id: "pending-1", promoted: true })]);
    expect(plan.updates[0].incoming.providerRef).toBe("BOOKED-77");
    expect(plan.removals).toHaveLength(0);
  });

  it("promotes when the final amount differs a little at the same merchant (tip, fuel hold)", () => {
    const pending = incoming(
      raw({ status: "PDNG", entry_reference: null, booking_date: null, transaction_amount: { amount: "400.00", currency: "NOK" } }),
    );
    const plan = reconcile([asStored(pending[0], "p")], incoming(raw({ transaction_amount: { amount: "460.00", currency: "NOK" } })), window);
    expect(plan.updates[0]).toMatchObject({ id: "p", promoted: true });
  });

  it("soft-removes pending items the bank no longer returns", () => {
    const pending = incoming(raw({ status: "PDNG", entry_reference: null, booking_date: null, creditor: { name: "Hotel" } }));
    const plan = reconcile([asStored(pending[0], "gone")], [], window);
    expect(plan.removals).toEqual(["gone"]);
  });

  it("does not remove booked history outside the bank's returned range", () => {
    const old = incoming(raw({ booking_date: "2026-09-01" }));
    const plan = reconcile([asStored(old[0], "old")], [], window);
    expect(plan.removals).toEqual([]);
  });

  it("matches by bank reference even if the description changed", () => {
    const before = incoming(raw());
    const plan = reconcile(
      [asStored(before[0], "a")],
      incoming(raw({ remittance_information: ["REMA 1000 MAJORSTUA OSLO"] })),
      window,
    );
    expect(plan.inserts).toHaveLength(0);
    expect(plan.updates[0].id).toBe("a");
  });

  it("matches booked rows without references when only the description is unstable", () => {
    const before = incoming(raw({ entry_reference: null }));
    const plan = reconcile(
      [asStored(before[0], "a")],
      incoming(raw({ entry_reference: null, remittance_information: ["REMA 1000 MAJORSTUA"] })),
      window,
    );
    expect(plan.inserts).toHaveLength(0);
    expect(plan.updates[0].id).toBe("a");
  });

  it("restores a soft-removed row that comes back", () => {
    const tx = incoming(raw({ status: "PDNG", entry_reference: null, booking_date: null }));
    const plan = reconcile([asStored(tx[0], "x", { removedAt: "2026-10-12T00:00:00Z" })], tx, window);
    expect(plan.updates[0]).toMatchObject({ id: "x", restored: true });
  });
});
