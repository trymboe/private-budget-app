"use client";

import { Check } from "lucide-react";
import { CategoryMark } from "@/components/category-icon";
import type { Category } from "@/lib/data/types";
import { cn } from "@/lib/utils";

/**
 * One-tap category choice. Large targets in two columns on phones. The suggested
 * category (if any) is shown separately above, so this grid is a stable layout the
 * thumb can learn: categories never move around between transactions.
 */
export function CategoryGrid({
  categories,
  selectedId,
  onSelect,
  disabled,
  showShortcuts = false,
}: {
  categories: Category[];
  selectedId?: string | null;
  onSelect: (category: Category) => void;
  disabled?: boolean;
  showShortcuts?: boolean;
}) {
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="list">
      {categories.map((c, i) => {
        const selected = c.id === selectedId;
        return (
          <li key={c.id}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onSelect(c)}
              aria-pressed={selected}
              className={cn(
                "flex h-14 w-full items-center gap-2.5 rounded-md bg-surface px-3 text-left text-sm ring-1 ring-inset transition-[background-color,box-shadow,transform] duration-150 active:scale-[0.97] disabled:opacity-50",
                selected ? "ring-2 ring-ink" : "ring-line hover:ring-line-strong",
              )}
            >
              <CategoryMark icon={c.icon} color={c.color} size="sm" />
              <span className="min-w-0 flex-1 truncate leading-tight">{c.name}</span>
              {selected ? <Check className="size-4 shrink-0" aria-hidden /> : null}
              {showShortcuts && i < 9 && !selected ? (
                <kbd className="hidden shrink-0 font-sans text-2xs text-ink-3 lg:inline">{i + 1}</kbd>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Expense categories first for money out; income first for money in (refunds still reachable). */
export function orderForAmount(categories: Category[], amountMinor: number): Category[] {
  const active = categories.filter((c) => !c.archived);
  const expense = active.filter((c) => c.kind === "expense");
  const income = active.filter((c) => c.kind === "income");
  return amountMinor > 0 ? [...income, ...expense] : [...expense, ...income];
}
