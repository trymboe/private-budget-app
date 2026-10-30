import { ArrowLeftRight, CircleDashed, EyeOff, Split } from "lucide-react";
import { CategoryMark } from "@/components/category-icon";
import { Amount } from "@/components/ui/amount";
import type { Category, TransactionListItem } from "@/lib/data/types";
import { displayMerchant } from "@/lib/merchant";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

export function TransactionRow({
  tx,
  categories,
  onOpen,
}: {
  tx: TransactionListItem;
  categories: Map<string, Category>;
  onOpen: (tx: TransactionListItem) => void;
}) {
  const merchant = displayMerchant(tx.counterparty, tx.description);
  const first = tx.allocations[0] ? categories.get(tx.allocations[0].categoryId) : undefined;
  const suggested = tx.suggestedCategoryId ? categories.get(tx.suggestedCategoryId) : undefined;

  let mark: React.ReactNode;
  let subline: React.ReactNode;
  if (tx.treatment === "transfer") {
    mark = <NeutralMark icon={ArrowLeftRight} />;
    subline = "Transfer";
  } else if (tx.treatment === "excluded") {
    mark = <NeutralMark icon={EyeOff} />;
    subline = "Excluded from budget";
  } else if (tx.allocations.length > 1) {
    mark = <NeutralMark icon={Split} />;
    subline = `Split · ${tx.allocations.map((a) => categories.get(a.categoryId)?.name ?? "Category").join(", ")}`;
  } else if (first) {
    mark = <CategoryMark icon={first.icon} color={first.color} />;
    subline = first.name;
  } else {
    mark = <NeutralMark icon={CircleDashed} dashed />;
    subline = (
      <span className="text-accent">
        Needs review{suggested ? <span className="text-ink-3"> · {suggested.name}?</span> : null}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onOpen(tx)}
      className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3.5 rounded-md px-2 py-3 text-left transition-colors hover:bg-sunken/50 active:bg-sunken"
    >
      {mark}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{merchant}</span>
          {tx.status === "pending" ? (
            <span className="shrink-0 rounded-sm bg-sunken px-1.5 text-[10px] leading-4 font-medium tracking-wide text-ink-2 uppercase">
              Pending
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block truncate text-xs text-ink-3">{subline}</span>
      </span>
      <span className="shrink-0 text-right">
        <Amount
          minor={tx.amountMinor}
          currency={tx.currency}
          className={cn("text-sm", (tx.treatment !== "budget" || !tx.accountIncluded) && "text-ink-3")}
        />
        {tx.originalCurrency && tx.originalAmountMinor !== null ? (
          <span className="tnum block text-2xs text-ink-3">{formatMoney(Math.abs(tx.originalAmountMinor), tx.originalCurrency)}</span>
        ) : null}
      </span>
    </button>
  );
}

function NeutralMark({ icon: Icon, dashed }: { icon: React.ComponentType<{ className?: string; strokeWidth?: number }>; dashed?: boolean }) {
  return (
    <span aria-hidden className={cn("grid size-8 shrink-0 place-items-center rounded-md text-ink-3", dashed ? "ring-1 ring-dashed ring-line-strong" : "bg-sunken")}>
      <Icon className="size-4" strokeWidth={1.75} />
    </span>
  );
}
