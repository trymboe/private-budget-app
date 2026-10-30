"use client";

import { useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { splitTransaction } from "@/app/actions/transactions";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { validateSplit } from "@/lib/budget";
import type { Category, TransactionListItem } from "@/lib/data/types";
import { formatMoney, minorToDecimalString, parseDecimalToMinor } from "@/lib/money";
import { cn } from "@/lib/utils";

type Part = { key: number; categoryId: string; amount: string };

/**
 * Split one transaction across categories. Amounts are typed as positive numbers
 * in the transaction's direction; the remainder is shown live and the last part
 * can be filled with it in one tap. Saving requires an exact match.
 */
export function SplitEditor({
  transaction,
  categories,
  onDone,
}: {
  transaction: TransactionListItem;
  categories: Category[];
  onDone: () => void;
}) {
  const sign = transaction.amountMinor < 0 ? -1 : 1;
  const total = Math.abs(transaction.amountMinor);
  const active = categories.filter((c) => !c.archived);
  const initial: Part[] =
    transaction.allocations.length > 0
      ? transaction.allocations.map((a, i) => ({
          key: i,
          categoryId: a.categoryId,
          amount: minorToDecimalString(Math.abs(a.amountMinor)).replace(".", ","),
        }))
      : [
          { key: 0, categoryId: transaction.suggestedCategoryId ?? "", amount: "" },
          { key: 1, categoryId: "", amount: "" },
        ];
  const [parts, setParts] = useState<Part[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const parsed = useMemo(
    () =>
      parts.map((p) => {
        try {
          return p.amount.trim() ? parseDecimalToMinor(p.amount, transaction.currency) : 0;
        } catch {
          return null;
        }
      }),
    [parts, transaction.currency],
  );
  const allocated = parsed.reduce<number>((s, v) => s + (v ?? 0), 0);
  const remaining = total - allocated;

  const update = (key: number, patch: Partial<Part>) => setParts((ps) => ps.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  async function save() {
    setError(null);
    if (parsed.some((v) => v === null)) return setError("Check the amounts: use numbers like 450 or 450,50.");
    if (parts.some((p) => !p.categoryId)) return setError("Choose a category for every part.");
    const payload = parts.map((p, i) => ({ categoryId: p.categoryId, amountMinor: sign * (parsed[i] ?? 0) }));
    const problem = validateSplit(transaction.amountMinor, payload);
    if (problem) return setError(problem);
    setSaving(true);
    const result = await splitTransaction(transaction.id, payload);
    setSaving(false);
    if (!result.ok) return setError(result.error);
    onDone();
  }

  return (
    <div className="space-y-4 pt-2">
      <ul className="space-y-2">
        {parts.map((p, i) => (
          <li key={p.key} className="flex items-center gap-2">
            <label className="sr-only" htmlFor={`split-cat-${p.key}`}>
              Category for part {i + 1}
            </label>
            <select
              id={`split-cat-${p.key}`}
              value={p.categoryId}
              onChange={(e) => update(p.key, { categoryId: e.target.value })}
              className="h-12 min-w-0 flex-1 rounded-md bg-surface px-3 text-sm ring-1 ring-inset ring-line-strong focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="">Category…</option>
              {active.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <label className="sr-only" htmlFor={`split-amt-${p.key}`}>
              Amount for part {i + 1}
            </label>
            <input
              id={`split-amt-${p.key}`}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              value={p.amount}
              onChange={(e) => update(p.key, { amount: e.target.value })}
              onFocus={() => {
                if (!p.amount && remaining > 0 && i === parts.length - 1) {
                  update(p.key, { amount: minorToDecimalString(remaining, transaction.currency).replace(".", ",") });
                }
              }}
              className={cn(
                "tnum h-12 w-28 rounded-md bg-surface px-3 text-right text-sm ring-1 ring-inset ring-line-strong focus:outline-none focus:ring-2 focus:ring-accent",
                parsed[i] === null && "ring-brick",
              )}
            />
            <button
              type="button"
              onClick={() => setParts((ps) => ps.filter((x) => x.key !== p.key))}
              disabled={parts.length <= 1}
              className="grid size-10 shrink-0 place-items-center rounded-full text-ink-3 hover:bg-sunken hover:text-ink disabled:invisible"
              aria-label={`Remove part ${i + 1}`}
            >
              <X className="size-4" aria-hidden />
            </button>
          </li>
        ))}
      </ul>

      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setParts((ps) => [...ps, { key: Math.max(...ps.map((x) => x.key)) + 1, categoryId: "", amount: "" }])}
          disabled={parts.length >= 20}
        >
          <Plus className="size-4" aria-hidden /> Add part
        </Button>
        <p className={cn("tnum text-xs", remaining === 0 ? "text-accent" : "text-ink-2")} aria-live="polite">
          {remaining === 0
            ? "Adds up exactly"
            : remaining > 0
              ? `${formatMoney(remaining, transaction.currency)} left to allocate`
              : `${formatMoney(-remaining, transaction.currency)} too much`}
        </p>
      </div>

      <FieldError>{error}</FieldError>
      <Button block size="lg" onClick={save} disabled={saving || remaining !== 0}>
        {saving ? "Saving…" : `Save split of ${formatMoney(total, transaction.currency)}`}
      </Button>
    </div>
  );
}
