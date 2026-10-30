"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { addManualTransaction, updateManualTransaction } from "@/app/actions/manual";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label, SectionLabel } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import type { Category, TransactionListItem } from "@/lib/data/types";
import type { IsoDate } from "@/lib/dates";
import { minorToDecimalString } from "@/lib/money";
import { cn } from "@/lib/utils";
import { CategoryGrid, orderForAmount } from "./category-grid";

/** "Add" button for the transactions page, with its own sheet. */
export function AddTransactionButton({ categories, today }: { categories: Category[]; today: IsoDate }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden /> Add
      </Button>
      <Sheet open={open} onOpenChange={setOpen} title="Add a transaction" description="For cash and anything your bank does not show.">
        {open ? <ManualTransactionForm categories={categories} today={today} onDone={() => setOpen(false)} /> : null}
      </Sheet>
    </>
  );
}

/**
 * Create or edit a transaction entered by hand. Category is chosen here only when
 * adding; an existing one is re-categorised from the normal transaction sheet.
 */
export function ManualTransactionForm({
  categories,
  today,
  editing,
  onDone,
}: {
  categories: Category[];
  today: IsoDate;
  editing?: TransactionListItem;
  onDone: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [direction, setDirection] = useState<"out" | "in">(editing && editing.amountMinor > 0 ? "in" : "out");
  const [amount, setAmount] = useState(editing ? minorToDecimalString(Math.abs(editing.amountMinor), editing.currency).replace(".", ",") : "");
  const [description, setDescription] = useState(editing?.counterparty ?? "");
  const [date, setDate] = useState<IsoDate>(editing?.effectiveDate ?? today);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const entry = { date, amount, direction, description };
    startTransition(async () => {
      const r = editing
        ? await updateManualTransaction(editing.id, entry)
        : await addManualTransaction({ ...entry, categoryId: categoryId ?? undefined });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      toast({ message: editing ? "Saved" : "Transaction added" });
      router.refresh();
      onDone();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-6 pt-1">
      <div className="grid grid-cols-2 gap-1 rounded-md bg-sunken p-1" role="radiogroup" aria-label="Direction">
        {(
          [
            ["out", "Money out"],
            ["in", "Money in"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={direction === value}
            onClick={() => setDirection(value)}
            className={cn(
              "h-10 rounded-[7px] text-xs font-medium transition-colors",
              direction === value ? "bg-surface text-ink shadow-sm" : "text-ink-2 hover:text-ink",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        <Label htmlFor="manual-amount">Amount</Label>
        <Input
          id="manual-amount"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="tnum"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="manual-description">Description</Label>
        <Input
          id="manual-description"
          maxLength={120}
          placeholder="e.g. Coffee, cash"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="manual-date">Date</Label>
        <Input id="manual-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
      </div>

      {!editing ? (
        <div>
          <SectionLabel>Category (optional)</SectionLabel>
          <div className="mt-3">
            <CategoryGrid
              categories={orderForAmount(categories, direction === "in" ? 1 : -1)}
              selectedId={categoryId}
              onSelect={(c) => setCategoryId((current) => (current === c.id ? null : c.id))}
              disabled={pending}
            />
          </div>
          <p className="mt-2 text-xs text-ink-3">Without a category it goes to Review, like a bank transaction.</p>
        </div>
      ) : null}

      <FieldError>{error}</FieldError>
      <Button type="submit" block disabled={pending}>
        {pending ? "Saving…" : editing ? "Save changes" : "Add transaction"}
      </Button>
    </form>
  );
}
