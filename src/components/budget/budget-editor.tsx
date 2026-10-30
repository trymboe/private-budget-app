"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { copyBudget, setCategoryBudget } from "@/app/actions/budget";
import { CategoryMark } from "@/components/category-icon";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { Category } from "@/lib/data/types";
import { formatMonth, type IsoDate } from "@/lib/dates";
import { formatMoney, minorToDecimalString, parseDecimalToMinor } from "@/lib/money";
import { cn } from "@/lib/utils";

function toInput(minor: number | undefined) {
  if (!minor) return "";
  return minorToDecimalString(minor).replace(/\.00$/, "").replace(".", ",");
}

/**
 * Budget for one month. Each amount saves on blur and only affects this month;
 * earlier months keep their own snapshot. Spending this month is shown alongside
 * for context.
 */
export function BudgetEditor({
  month,
  previousMonth,
  previousHasBudget,
  categories,
  budgets,
  spent,
  editable,
}: {
  month: IsoDate;
  previousMonth: IsoDate;
  previousHasBudget: boolean;
  categories: Category[];
  budgets: Record<string, number>;
  spent: Record<string, number>;
  editable: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(categories.map((c) => [c.id, toInput(budgets[c.id])])),
  );
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [pending, startTransition] = useTransition();

  const total = useMemo(
    () =>
      Object.values(values).reduce((sum, v) => {
        try {
          return sum + (v.trim() ? parseDecimalToMinor(v) : 0);
        } catch {
          return sum;
        }
      }, 0),
    [values],
  );
  const hasAny = Object.values(budgets).some((v) => v > 0);

  function save(categoryId: string) {
    const raw = values[categoryId] ?? "";
    let minor = 0;
    try {
      minor = raw.trim() ? parseDecimalToMinor(raw) : 0;
    } catch {
      setErrors((e) => ({ ...e, [categoryId]: true }));
      return;
    }
    setErrors((e) => ({ ...e, [categoryId]: false }));
    if (minor === (budgets[categoryId] ?? 0)) return;
    startTransition(async () => {
      const result = await setCategoryBudget(categoryId, month, raw);
      if (!result.ok) {
        toast({ message: result.error, tone: "error" });
        return;
      }
      toast({ message: `Saved for ${formatMonth(month)}` });
      router.refresh();
    });
  }

  function copyPrevious() {
    startTransition(async () => {
      const result = await copyBudget(previousMonth, month, hasAny);
      if (!result.ok) return toast({ message: result.error, tone: "error" });
      toast({ message: `Copied from ${formatMonth(previousMonth)}` });
      router.refresh();
    });
  }

  return (
    <div>
      <div className="flex items-end justify-between gap-4 border-b border-line pb-5">
        <div>
          <p className="eyebrow">Total budget</p>
          <p className="tnum mt-2 font-display text-2xl leading-none">{formatMoney(total, "NOK", { decimals: "never" })}</p>
        </div>
        {editable && previousHasBudget ? (
          <Button variant="secondary" size="sm" onClick={copyPrevious} disabled={pending}>
            Copy {formatMonth(previousMonth, { short: true })}
          </Button>
        ) : null}
      </div>

      <ul className="divide-y divide-line">
        {categories.map((c) => {
          const s = spent[c.id] ?? 0;
          return (
            <li key={c.id} className="flex items-center gap-3.5 py-3">
              <CategoryMark icon={c.icon} color={c.color} />
              <div className="min-w-0 flex-1">
                <label htmlFor={`b-${c.id}`} className="block truncate text-sm font-medium">
                  {c.name}
                </label>
                <p className="tnum text-2xs text-ink-3">
                  {s !== 0 ? `${formatMoney(s, "NOK", { decimals: "never" })} spent` : c.isFixed ? "Fixed cost" : " "}
                </p>
              </div>
              <div className="relative">
                <input
                  id={`b-${c.id}`}
                  inputMode="decimal"
                  autoComplete="off"
                  disabled={!editable}
                  placeholder="0"
                  value={values[c.id] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [c.id]: e.target.value }))}
                  onBlur={() => save(c.id)}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                  aria-invalid={errors[c.id] || undefined}
                  className={cn(
                    "tnum h-11 w-32 rounded-md bg-surface pr-9 pl-3 text-right text-sm ring-1 ring-inset ring-line focus:outline-none focus:ring-2 focus:ring-accent disabled:bg-transparent disabled:ring-0",
                    errors[c.id] && "ring-brick",
                  )}
                />
                <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-ink-3">kr</span>
              </div>
            </li>
          );
        })}
      </ul>
      {!editable ? (
        <p className="mt-4 text-xs text-ink-3">Past months are kept as they were, so your history stays accurate.</p>
      ) : null}
    </div>
  );
}
