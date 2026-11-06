// Turns parsed rows from another app's export into an exact import plan: which
// categories are reused or created, which rows are imported, and which are skipped
// and why. Pure (no database), so the preview the user approves and the import that
// runs afterwards are computed by the same code from the same file.
import { createHash } from "node:crypto";
import type { IsoDate } from "@/lib/dates";
import type { Minor } from "@/lib/money";

export type ImportRow = {
  /** 1-based line in the file, for messages. */
  line: number;
  date: IsoDate;
  /** Signed: negative = money out. */
  amountMinor: Minor;
  currency: string;
  /** Category name as written in the file; null when the row has none. */
  category: string | null;
  /** Explicit kind from the file, if the format has one. */
  kind: "expense" | "income" | null;
  description: string | null;
  note: string | null;
};

export type ExistingCategory = {
  id: string;
  name: string;
  kind: "expense" | "income";
  archived: boolean;
  /** Set when the category was merged into another one. */
  mergedIntoId: string | null;
};

export type CategoryDecision =
  | { action: "existing"; categoryId: string }
  | { action: "create"; kind: "expense" | "income" };

export type PlannedCategory = {
  /** Normalised key (trimmed, case-insensitive). */
  key: string;
  name: string;
  rowCount: number;
  spentMinor: Minor;
  receivedMinor: Minor;
  /** What the app suggests: reuse a category with the same name or create one. */
  suggestion: CategoryDecision;
  decision: CategoryDecision;
};

export type PlannedTransaction = ImportRow & { fingerprint: string; categoryKey: string | null };

export type SkipReason = "after_cutoff" | "zero_amount" | "other_currency" | "already_imported";

export type ImportPlan = {
  categories: PlannedCategory[];
  transactions: PlannedTransaction[];
  skipped: { reason: SkipReason; count: number }[];
  firstDate: IsoDate | null;
  lastDate: IsoDate | null;
  totalOutMinor: Minor;
  totalInMinor: Minor;
  uncategorized: number;
};

export type PlanOptions = {
  /** Currency of the account the rows go into; other currencies are left out. */
  currency: string;
  /** Rows dated on or after this day are left out (the bank already has them). */
  cutoff: IsoDate | null;
  /** User choices per category key; anything missing uses the suggestion. */
  decisions?: Record<string, CategoryDecision>;
  /** Fingerprints already stored for this import source. */
  existingFingerprints?: ReadonlySet<string>;
};

export function categoryKey(name: string): string {
  return name.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("nb-NO");
}

/** Stable id for a row: same content + same position among identical rows. */
export function fingerprintRows(source: string, rows: ImportRow[]): string[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const content = [r.date, r.amountMinor, r.currency, r.category ? categoryKey(r.category) : "", r.description ?? "", r.note ?? ""].join("\u001f");
    const hash = createHash("sha256").update(content).digest("hex").slice(0, 40);
    const n = (seen.get(hash) ?? 0) + 1;
    seen.set(hash, n);
    return `${source}:${hash}:${n}`;
  });
}

function suggestCategory(
  key: string,
  rows: ImportRow[],
  existing: ExistingCategory[],
): CategoryDecision {
  const byId = new Map(existing.map((c) => [c.id, c]));
  const sameName = existing.filter((c) => categoryKey(c.name) === key);
  const active = sameName.find((c) => !c.archived);
  if (active) return { action: "existing", categoryId: active.id };
  // Merged away earlier: follow the merge to where its history lives now.
  for (const c of sameName) {
    let target = c.mergedIntoId ? byId.get(c.mergedIntoId) : undefined;
    for (let hops = 0; target && target.mergedIntoId && hops < 10; hops++) target = byId.get(target.mergedIntoId);
    if (target && !target.archived) return { action: "existing", categoryId: target.id };
  }
  const explicit = rows.find((r) => r.kind)?.kind;
  if (explicit) return { action: "create", kind: explicit };
  return { action: "create", kind: rows.every((r) => r.amountMinor > 0) ? "income" : "expense" };
}

export function buildPlan(
  source: string,
  rows: ImportRow[],
  existing: ExistingCategory[],
  options: PlanOptions,
): ImportPlan {
  const fingerprints = fingerprintRows(source, rows);
  const skipped = new Map<SkipReason, number>();
  const skip = (reason: SkipReason) => skipped.set(reason, (skipped.get(reason) ?? 0) + 1);
  const transactions: PlannedTransaction[] = [];

  rows.forEach((row, i) => {
    if (row.amountMinor === 0) return skip("zero_amount");
    if (row.currency !== options.currency) return skip("other_currency");
    if (options.cutoff && row.date >= options.cutoff) return skip("after_cutoff");
    if (options.existingFingerprints?.has(fingerprints[i])) return skip("already_imported");
    const key = row.category && row.category.trim() ? categoryKey(row.category) : null;
    transactions.push({ ...row, fingerprint: fingerprints[i], categoryKey: key });
  });

  const groups = new Map<string, PlannedTransaction[]>();
  for (const t of transactions) {
    if (!t.categoryKey) continue;
    const list = groups.get(t.categoryKey);
    if (list) list.push(t);
    else groups.set(t.categoryKey, [t]);
  }

  const activeIds = new Set(existing.filter((c) => !c.archived).map((c) => c.id));
  const categories: PlannedCategory[] = [...groups.entries()]
    .map(([key, list]) => {
      const suggestion = suggestCategory(key, list, existing);
      const chosen = options.decisions?.[key];
      // "Create" is not possible while an active category already has that name
      // (names are unique), so it falls back to reusing that category.
      const nameTaken = existing.some((c) => !c.archived && categoryKey(c.name) === key);
      const valid = chosen && (chosen.action === "create" ? !nameTaken : activeIds.has(chosen.categoryId));
      const decision = valid ? chosen : suggestion;
      // Most common spelling in the file becomes the new category's name.
      const spellings = new Map<string, number>();
      for (const t of list) {
        const name = t.category!.trim().replace(/\s+/g, " ");
        spellings.set(name, (spellings.get(name) ?? 0) + 1);
      }
      const name = [...spellings.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
      return {
        key,
        name: name.slice(0, 60),
        rowCount: list.length,
        spentMinor: list.reduce((s, t) => (t.amountMinor < 0 ? s - t.amountMinor : s), 0),
        receivedMinor: list.reduce((s, t) => (t.amountMinor > 0 ? s + t.amountMinor : s), 0),
        suggestion,
        decision,
      };
    })
    .sort((a, b) => b.rowCount - a.rowCount || a.name.localeCompare(b.name, "nb-NO"));

  const dates = transactions.map((t) => t.date).sort();
  return {
    categories,
    transactions,
    skipped: [...skipped.entries()].map(([reason, count]) => ({ reason, count })),
    firstDate: dates[0] ?? null,
    lastDate: dates.at(-1) ?? null,
    totalOutMinor: transactions.reduce((s, t) => (t.amountMinor < 0 ? s - t.amountMinor : s), 0),
    totalInMinor: transactions.reduce((s, t) => (t.amountMinor > 0 ? s + t.amountMinor : s), 0),
    uncategorized: transactions.filter((t) => !t.categoryKey).length,
  };
}
