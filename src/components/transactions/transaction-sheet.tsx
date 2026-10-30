"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { categorize, saveNote, setTreatment } from "@/app/actions/transactions";
import { CategoryMark } from "@/components/category-icon";
import { Button } from "@/components/ui/button";
import { Label, SectionLabel, Textarea } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import type { Category, TransactionListItem, Treatment } from "@/lib/data/types";
import { formatDay, type IsoDate } from "@/lib/dates";
import { displayMerchant } from "@/lib/merchant";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { CategoryGrid, orderForAmount } from "./category-grid";
import { SplitEditor } from "./split-editor";

type SheetProps = {
  tx: TransactionListItem | null;
  categories: Category[];
  today: IsoDate;
  onClose: () => void;
  onChanged: (tx: TransactionListItem) => void;
};

/** Details and editing for one transaction, in a bottom sheet. */
export function TransactionSheet(props: SheetProps) {
  // Keep showing the last transaction while the sheet animates closed.
  const [shown, setShown] = useState(props.tx);
  if (props.tx && props.tx !== shown) setShown(props.tx);
  if (!shown) return null;
  return <TransactionDetails key={shown.id} {...props} tx={shown} open={props.tx !== null} />;
}

function TransactionDetails({
  tx,
  open,
  categories,
  today,
  onClose,
  onChanged,
}: Omit<SheetProps, "tx"> & { tx: TransactionListItem; open: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [mode, setMode] = useState<"details" | "split">("details");
  const [note, setNote] = useState(tx.note ?? "");
  const [pending, startTransition] = useTransition();

  const merchant = displayMerchant(tx.counterparty, tx.description);
  const byId = new Map(categories.map((c) => [c.id, c]));
  const selectedId = tx.allocations.length === 1 ? tx.allocations[0].categoryId : null;

  function run(action: () => Promise<{ ok: boolean; error?: string }>, optimistic: TransactionListItem, message: string) {
    onChanged(optimistic);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        onChanged(tx!);
        toast({ message: result.error ?? "That did not save.", tone: "error" });
        return;
      }
      toast({ message });
      router.refresh();
    });
  }

  function pickCategory(c: Category) {
    run(
      () => categorize([tx!.id], c.id),
      { ...tx!, treatment: "budget", needsReview: false, allocations: [{ categoryId: c.id, amountMinor: tx!.amountMinor }] },
      `Saved as ${c.name}`,
    );
  }

  function pickTreatment(t: Treatment) {
    if (t === tx!.treatment) return;
    run(
      () => setTreatment([tx!.id], t),
      { ...tx!, treatment: t, needsReview: t === "budget" ? tx!.allocations.length === 0 : false, allocations: t === "budget" ? tx!.allocations : [] },
      t === "transfer" ? "Marked as transfer" : t === "excluded" ? "Excluded from budget" : "Counts toward budget",
    );
  }

  function persistNote() {
    if ((tx!.note ?? "") === note.trim()) return;
    run(() => saveNote(tx!.id, note), { ...tx!, note: note.trim() || null }, "Note saved");
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()} title={mode === "split" ? `Split ${merchant}` : merchant}>
      {mode === "split" ? (
        <SplitEditor
          transaction={tx}
          categories={categories}
          onDone={() => {
            toast({ message: "Split saved" });
            router.refresh();
            onClose();
          }}
        />
      ) : (
        <div className="space-y-7 pt-1">
          <div>
            <p className={cn("tnum font-display text-2xl leading-none", tx.amountMinor > 0 && "text-accent")}>
              {tx.amountMinor > 0 ? "+" : ""}
              {formatMoney(Math.abs(tx.amountMinor), tx.currency)}
            </p>
            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-xs">
              <dt className="text-ink-3">Date</dt>
              <dd>
                {formatDay(tx.effectiveDate, today)}
                {tx.status === "pending" ? " · Pending" : ""}
              </dd>
              <dt className="text-ink-3">Account</dt>
              <dd>
                {tx.accountName}
                {tx.isDemo ? " · Demo data" : ""}
                {!tx.accountIncluded ? " · not in budget" : ""}
              </dd>
              {tx.originalCurrency && tx.originalAmountMinor !== null ? (
                <>
                  <dt className="text-ink-3">Original</dt>
                  <dd className="tnum">{formatMoney(Math.abs(tx.originalAmountMinor), tx.originalCurrency)}</dd>
                </>
              ) : null}
              {tx.description ? (
                <>
                  <dt className="text-ink-3">Bank text</dt>
                  <dd className="break-words text-ink-2">{tx.description}</dd>
                </>
              ) : null}
            </dl>
          </div>

          <div>
            <SectionLabel>Counts as</SectionLabel>
            <div className="mt-3 grid grid-cols-3 gap-1 rounded-md bg-sunken p-1" role="radiogroup" aria-label="Treatment">
              {(
                [
                  ["budget", tx.amountMinor > 0 ? "Income / refund" : "Spending"],
                  ["transfer", "Transfer"],
                  ["excluded", "Excluded"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={tx.treatment === value}
                  onClick={() => pickTreatment(value)}
                  disabled={pending}
                  className={cn(
                    "h-10 rounded-[7px] text-xs font-medium transition-colors",
                    tx.treatment === value ? "bg-surface text-ink shadow-sm" : "text-ink-2 hover:text-ink",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            {tx.treatment === "transfer" ? (
              <p className="mt-2 text-xs text-ink-3">Moves between your own accounts never count as spending or income.</p>
            ) : tx.treatment === "excluded" ? (
              <p className="mt-2 text-xs text-ink-3">Ignored in budgets and insights, but kept in your history.</p>
            ) : null}
          </div>

          {tx.treatment === "budget" ? (
            <div>
              <div className="flex items-baseline justify-between">
                <SectionLabel>Category</SectionLabel>
                <button type="button" onClick={() => setMode("split")} className="text-xs font-medium text-ink-2 underline-offset-4 hover:text-ink hover:underline">
                  {tx.allocations.length > 1 ? "Edit split" : "Split"}
                </button>
              </div>
              {tx.allocations.length > 1 ? (
                <ul className="mt-3 divide-y divide-line rounded-md ring-1 ring-line">
                  {tx.allocations.map((a) => {
                    const c = byId.get(a.categoryId);
                    return (
                      <li key={a.categoryId} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                        {c ? <CategoryMark icon={c.icon} color={c.color} size="sm" /> : null}
                        <span className="flex-1">{c?.name ?? "Category"}</span>
                        <span className="tnum">{formatMoney(Math.abs(a.amountMinor), tx.currency)}</span>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              {tx.needsReview && tx.suggestedCategoryId && byId.get(tx.suggestedCategoryId) ? (
                <p className="mt-2 text-xs text-ink-2">Suggested: {byId.get(tx.suggestedCategoryId)!.name}</p>
              ) : null}
              <div className="mt-3">
                <CategoryGrid
                  categories={orderForAmount(categories, tx.amountMinor)}
                  selectedId={selectedId}
                  onSelect={pickCategory}
                  disabled={pending}
                />
              </div>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="tx-note">Note</Label>
            <Textarea
              id="tx-note"
              value={note}
              maxLength={1000}
              placeholder="Add a note for yourself"
              onChange={(e) => setNote(e.target.value)}
              onBlur={persistNote}
            />
          </div>

          <Button variant="secondary" block onClick={onClose}>
            Done
          </Button>
        </div>
      )}
    </Sheet>
  );
}
