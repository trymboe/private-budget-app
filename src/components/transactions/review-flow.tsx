"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { ArrowLeftRight, Check, EyeOff, Split, X } from "lucide-react";
import { categorize, setTreatment, undoReview } from "@/app/actions/transactions";
import { CategoryMark } from "@/components/category-icon";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import type { Category, TransactionListItem } from "@/lib/data/types";
import { formatDay, type IsoDate } from "@/lib/dates";
import { displayMerchant } from "@/lib/merchant";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { CategoryGrid, orderForAmount } from "./category-grid";
import { SplitEditor } from "./split-editor";

type Decision =
  | { kind: "category"; category: Category; ids: string[] }
  | { kind: "transfer" | "excluded"; ids: string[] };

/**
 * The categorisation queue: one transaction at a time, decided with one tap,
 * then the next one slides in. Saves happen in the background (optimistic);
 * every decision can be undone from the toast.
 */
export function ReviewFlow({ initial, categories, today }: { initial: TransactionListItem[]; categories: Category[]; today: IsoDate }) {
  const router = useRouter();
  const toast = useToast();
  const [queue, setQueue] = useState(initial);
  const [doneCount, setDoneCount] = useState(0);
  const [leaving, setLeaving] = useState(false);
  // The bulk toggle belongs to one transaction; it resets when the next one shows.
  const [applyFor, setApplyFor] = useState<string | null>(null);
  const [splitOpen, setSplitOpen] = useState(false);
  const [, startTransition] = useTransition();

  const current = queue[0];
  const total = doneCount + queue.length;
  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const ordered = useMemo(() => (current ? orderForAmount(categories, current.amountMinor) : []), [categories, current]);
  const sameMerchant = useMemo(
    () => (current?.merchantKey ? queue.slice(1).filter((t) => t.merchantKey === current.merchantKey) : []),
    [queue, current],
  );
  const suggested = current?.suggestedCategoryId ? byId.get(current.suggestedCategoryId) : undefined;
  const merchant = current ? displayMerchant(current.counterparty, current.description) : "";

  const applyToSame = !!current && applyFor === current.id;

  const decide = useCallback(
    (decision: Decision) => {
      if (!current || leaving) return;
      const removed = queue.filter((t) => decision.ids.includes(t.id));
      setLeaving(true);
      setTimeout(() => {
        setQueue((q) => q.filter((t) => !decision.ids.includes(t.id)));
        setDoneCount((n) => n + decision.ids.length);
        setLeaving(false);
      }, 170);

      startTransition(async () => {
        const result =
          decision.kind === "category"
            ? await categorize(decision.ids, decision.category.id)
            : await setTreatment(decision.ids, decision.kind);
        if (!result.ok) {
          toast({ message: result.error, tone: "error" });
          setQueue((q) => [...removed, ...q.filter((t) => !decision.ids.includes(t.id))]);
          setDoneCount((n) => n - decision.ids.length);
          return;
        }
        const label =
          decision.kind === "category" ? decision.category.name : decision.kind === "transfer" ? "Transfer" : "Excluded";
        toast({
          message: decision.ids.length > 1 ? `${label} · ${decision.ids.length} transactions` : label,
          action: {
            label: "Undo",
            onClick: () =>
              startTransition(async () => {
                const undo = await undoReview(decision.ids);
                if (!undo.ok) return toast({ message: undo.error, tone: "error" });
                setQueue((q) => [...removed, ...q]);
                setDoneCount((n) => n - decision.ids.length);
              }),
          },
        });
      });
    },
    [current, leaving, queue, toast],
  );

  const chooseCategory = useCallback(
    (category: Category) => {
      if (!current) return;
      const ids = applyToSame ? [current.id, ...sameMerchant.map((t) => t.id)] : [current.id];
      decide({ kind: "category", category, ids });
    },
    [applyToSame, current, decide, sameMerchant],
  );

  const skip = useCallback(() => {
    setQueue((q) => (q.length > 1 ? [...q.slice(1), q[0]] : q));
  }, []);

  // Keyboard: 1-9 pick a category, Enter accepts the suggestion, S skips.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (splitOpen || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (/^[1-9]$/.test(e.key)) {
        const c = ordered[Number(e.key) - 1];
        if (c) chooseCategory(c);
      } else if (e.key === "Enter" && suggested) {
        chooseCategory(suggested);
      } else if (e.key.toLowerCase() === "s") {
        skip();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chooseCategory, ordered, skip, splitOpen, suggested]);

  if (!current) {
    return (
      <div className="flex min-h-[60dvh] flex-col items-center justify-center text-center animate-fade-up">
        <div className="grid size-14 place-items-center rounded-full bg-accent-soft text-accent">
          <Check className="size-6" aria-hidden />
        </div>
        <h1 className="mt-6 font-display text-2xl leading-none">All caught up.</h1>
        <p className="mt-3 max-w-xs text-sm text-ink-2">
          {doneCount > 0
            ? `You reviewed ${doneCount} ${doneCount === 1 ? "transaction" : "transactions"}. Your budget is up to date.`
            : "Nothing new to categorise right now."}
        </p>
        <Button className="mt-8" size="lg" onClick={() => router.push("/")}>
          See this month
        </Button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-4">
        <Link href="/" aria-label="Close review" className="-ml-2 grid size-10 place-items-center rounded-full text-ink-2 hover:bg-sunken">
          <X className="size-5" aria-hidden />
        </Link>
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-sunken" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={doneCount} aria-label="Review progress">
          <div className="h-full rounded-full bg-ink transition-[width] duration-300" style={{ width: `${total ? (doneCount / total) * 100 : 0}%` }} />
        </div>
        <p className="tnum w-14 text-right text-xs text-ink-2">
          {doneCount + 1} of {total}
        </p>
      </div>

      <article
        key={current.id}
        aria-live="polite"
        className={cn("mt-8 min-h-48", leaving ? "animate-card-out" : "animate-card-in")}
      >
        <p className="eyebrow">
          {formatDay(current.effectiveDate, today)} · {current.accountName}
          {current.status === "pending" ? " · Pending" : ""}
          {current.isDemo ? " · Demo data" : ""}
        </p>
        <h1 className="mt-3 font-display text-2xl leading-[1.05] tracking-tight break-words">{merchant}</h1>
        <p className={cn("tnum mt-3 text-xl", current.amountMinor > 0 && "text-accent")}>
          {current.amountMinor > 0 ? "+" : ""}
          {formatMoney(Math.abs(current.amountMinor), current.currency)}
        </p>
        {current.description && current.description !== current.counterparty ? (
          <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-ink-3">{current.description}</p>
        ) : null}
      </article>

      <div className="mt-6 space-y-3">
        {current.suggestedTreatment === "transfer" ? (
          <Button size="lg" block variant="accent" onClick={() => decide({ kind: "transfer", ids: [current.id] })}>
            <ArrowLeftRight className="size-4" aria-hidden />
            Looks like a transfer between your accounts
          </Button>
        ) : suggested ? (
          <Button size="lg" block variant="accent" onClick={() => chooseCategory(suggested)} className="justify-between">
            <span className="flex items-center gap-2.5">
              <CategoryMark icon={suggested.icon} color={suggested.color} size="sm" />
              {suggested.name}
            </span>
            <span className="text-xs font-normal opacity-80">Suggested · tap to confirm</span>
          </Button>
        ) : null}

        {sameMerchant.length > 0 ? (
          <label className="flex cursor-pointer items-center gap-3 rounded-md px-1 py-1.5 text-sm text-ink-2">
            <input
              type="checkbox"
              checked={applyToSame}
              onChange={(e) => setApplyFor(e.target.checked ? current.id : null)}
              className="size-5 rounded accent-[var(--ink)]"
            />
            Also apply to {sameMerchant.length} more from {merchant}
          </label>
        ) : null}
      </div>

      <div className="mt-5">
        <CategoryGrid categories={ordered} onSelect={chooseCategory} disabled={leaving} showShortcuts />
      </div>

      <div className="mt-5 grid grid-cols-4 gap-1 border-t border-line pt-3">
        <SecondaryAction icon={ArrowLeftRight} label="Transfer" onClick={() => decide({ kind: "transfer", ids: [current.id] })} />
        <SecondaryAction icon={EyeOff} label="Exclude" onClick={() => decide({ kind: "excluded", ids: [current.id] })} />
        <SecondaryAction icon={Split} label="Split" onClick={() => setSplitOpen(true)} />
        <SecondaryAction label="Skip" onClick={skip} disabled={queue.length < 2} />
      </div>

      <Sheet open={splitOpen} onOpenChange={setSplitOpen} title={`Split ${merchant}`} description="Divide this transaction between categories.">
        <SplitEditor
          transaction={current}
          categories={categories}
          onDone={() => {
            setSplitOpen(false);
            setQueue((q) => q.filter((t) => t.id !== current.id));
            setDoneCount((n) => n + 1);
            toast({ message: "Split saved" });
            router.refresh();
          }}
        />
      </Sheet>
    </div>
  );
}

function SecondaryAction({
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  icon?: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-14 flex-col items-center justify-center gap-1 rounded-md text-2xs text-ink-2 transition-colors hover:bg-sunken hover:text-ink disabled:opacity-40"
    >
      {Icon ? <Icon className="size-[18px]" aria-hidden /> : <span className="h-[18px] text-sm leading-[18px]">→</span>}
      {label}
    </button>
  );
}
