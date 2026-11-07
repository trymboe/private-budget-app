"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ChevronRight, Info, Repeat } from "lucide-react";
import { forgetSubscription, saveSubscriptionDecision, type SubscriptionDecisionInput } from "@/app/actions/subscriptions";
import { CategoryMark } from "@/components/category-icon";
import { EmptyState, Page, PageHeader } from "@/components/page";
import { Money } from "@/components/ui/amount";
import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import type { Category } from "@/lib/data/types";
import { formatShortDate, type IsoDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { CADENCE_LABEL, type SubscriptionItem, type SubscriptionTotals } from "@/lib/subscriptions";
import { cn } from "@/lib/utils";

const kr = (minor: number) => formatMoney(minor, "NOK", { decimals: "never" });
const krExact = (minor: number) => formatMoney(minor, "NOK");

export type SubscriptionsViewProps = {
  items: SubscriptionItem[];
  totals: SubscriptionTotals;
  categories: Category[];
  today: IsoDate;
  historyFrom: IsoDate;
};

type Status = "confirmed" | "dismissed" | "cancelled";

function day(date: IsoDate, today: IsoDate) {
  const short = formatShortDate(date);
  return date.slice(0, 4) === today.slice(0, 4) ? short : `${short} ${date.slice(0, 4)}`;
}

/** "Next 14 Nov", "Expected 3 Nov" (a little late) or "No charge since 5 Apr" (maybe ended). */
function timing(item: SubscriptionItem, today: IsoDate): { text: string; late: boolean } | null {
  if (item.overdue && item.lastCharge) return { text: `No charge since ${day(item.lastCharge.date, today)}`, late: true };
  if (!item.nextDate) return null;
  return item.nextDate < today
    ? { text: `Expected ${day(item.nextDate, today)}`, late: false }
    : { text: `Next ${day(item.nextDate, today)}`, late: false };
}

/** Subscriptions and fixed costs. Detection happens on the server; this handles the decisions. */
export function SubscriptionsView({ items, totals, categories, today, historyFrom }: SubscriptionsViewProps) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const byId = new Map(categories.map((c) => [c.id, c]));

  const found = items.filter((i) => i.status === "new");
  const active = items.filter((i) => i.status === "confirmed");
  const cancelled = items.filter((i) => i.status === "cancelled");
  const dismissed = items.filter((i) => i.status === "dismissed");
  const open = items.find((i) => i.key === openKey) ?? null;
  // Keep showing the last item while the sheet animates closed.
  const [shown, setShown] = useState<SubscriptionItem | null>(null);
  if (open && open !== shown) setShown(open);

  function inputFor(item: SubscriptionItem, status: Status, amountMinor: number): SubscriptionDecisionInput {
    return {
      id: item.decisionId,
      merchantKey: item.merchantKey,
      cadence: item.cadence,
      status,
      name: item.name,
      amountMinor,
      categoryId: item.categoryId,
      source: item.source,
      cancelledOn: status === "cancelled" ? (item.cancelledOn ?? today) : null,
    };
  }

  /** Save a decision, with Undo back to what it was before. */
  function decide(item: SubscriptionItem, status: Status, message: string, opts: { acceptPrice?: boolean } = {}) {
    const amount = status === "confirmed" && (opts.acceptPrice || item.status === "new") ? item.amountMinor : (item.acceptedMinor ?? item.amountMinor);
    const before = item.decisionId && item.status !== "new" ? inputFor(item, item.status as Status, item.acceptedMinor ?? item.amountMinor) : null;
    startTransition(async () => {
      const result = await saveSubscriptionDecision(inputFor(item, status, amount));
      if (!result.ok) {
        toast({ message: result.error, tone: "error" });
        return;
      }
      setOpenKey(null);
      router.refresh();
      toast({
        message,
        action: {
          label: "Undo",
          onClick: () =>
            startTransition(async () => {
              const restore = before ?? result.previous ?? null;
              const undo = restore ? await saveSubscriptionDecision(restore) : result.id ? await forgetSubscription(result.id) : null;
              if (undo && !undo.ok) toast({ message: undo.error, tone: "error" });
              router.refresh();
            }),
        },
      });
    });
  }

  function forget(item: SubscriptionItem) {
    if (!item.decisionId) return;
    if (item.source === "manual" && !confirm(`Stop tracking ${item.name}?`)) return;
    startTransition(async () => {
      const result = await forgetSubscription(item.decisionId!);
      if (!result.ok) {
        toast({ message: result.error, tone: "error" });
        return;
      }
      setOpenKey(null);
      toast({ message: item.source === "manual" ? `${item.name} removed` : `${item.name} is back in “Found”` });
      router.refresh();
    });
  }

  return (
    <Page>
      <PageHeader back={{ href: "/", label: "Home" }} eyebrow="Fixed costs" title="Subscriptions" />

      {items.length === 0 ? (
        <EmptyState title="No subscriptions found yet.">
          Måte looks for payments to the same place at a steady rhythm, weekly to yearly. They show up here after two or three
          charges. You can also add one from any transaction.
        </EmptyState>
      ) : (
        <>
          <section aria-label="Total">
            <p className="font-display text-3xl leading-none tracking-tight">
              <Money minor={totals.monthlyMinor} />
            </p>
            <p className="mt-3 text-sm text-ink-2">
              a month, {kr(totals.annualMinor)} a year, across {totals.activeCount}{" "}
              {totals.activeCount === 1 ? "subscription or fixed cost" : "subscriptions and fixed costs"}.
            </p>
            {totals.unconfirmedMonthlyMinor > 0 ? (
              <p className="mt-4 flex gap-2.5 text-xs leading-relaxed text-ink-2">
                <Info className="mt-0.5 size-3.5 shrink-0 text-ink-3" aria-hidden />
                <span>
                  Includes {kr(totals.unconfirmedMonthlyMinor)} a month that Måte found but you have not confirmed yet.
                </span>
              </p>
            ) : null}
          </section>

          {found.length > 0 ? (
            <section className="mt-10" aria-labelledby="found-heading">
              <div className="flex items-baseline justify-between">
                <SectionLabel id="found-heading">Found for you</SectionLabel>
                <p className="text-xs text-ink-3">Is this a subscription?</p>
              </div>
              <ul className="mt-3 space-y-3">
                {found.map((item) => (
                  <li key={item.key} className="rounded-lg bg-surface p-4 ring-1 ring-inset ring-line">
                    <button type="button" onClick={() => setOpenKey(item.key)} className="-m-1 flex w-[calc(100%+0.5rem)] items-start gap-3 rounded-md p-1 text-left">
                      <Mark item={item} byId={byId} />
                      <ItemText item={item} byId={byId} today={today} showSince />
                      <ItemAmount item={item} />
                    </button>
                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <Button variant="accent" size="sm" disabled={pending} onClick={() => decide(item, "confirmed", `Tracking ${item.name}`)}>
                        Yes, track it
                      </Button>
                      <Button variant="secondary" size="sm" disabled={pending} onClick={() => decide(item, "dismissed", `${item.name} hidden`)}>
                        Not a subscription
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {active.length > 0 ? (
            <section className="mt-10" aria-labelledby="active-heading">
              <div className="flex items-baseline justify-between">
                <SectionLabel id="active-heading">Active</SectionLabel>
                <p className="tnum text-xs text-ink-3">{active.length}</p>
              </div>
              <List items={active} byId={byId} today={today} onOpen={setOpenKey} />
            </section>
          ) : null}

          {cancelled.length > 0 ? (
            <section className="mt-10" aria-labelledby="cancelled-heading">
              <SectionLabel id="cancelled-heading">Cancelled</SectionLabel>
              <List items={cancelled} byId={byId} today={today} onOpen={setOpenKey} muted />
            </section>
          ) : null}

          {dismissed.length > 0 ? (
            <details className="group mt-10 border-t border-line pt-4">
              <summary className="flex cursor-pointer list-none items-center justify-between text-xs text-ink-2 hover:text-ink">
                <span>
                  Not subscriptions <span className="tnum text-ink-3">({dismissed.length})</span>
                </span>
                <ChevronRight className="size-4 transition-transform group-open:rotate-90" aria-hidden />
              </summary>
              <ul className="mt-2 divide-y divide-line">
                {dismissed.map((item) => (
                  <li key={item.key} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <span className="min-w-0 truncate text-ink-2">
                      {item.name} <span className="text-ink-3">· {CADENCE_LABEL[item.cadence].adjective.toLowerCase()}</span>
                    </span>
                    <Button variant="quiet" size="sm" disabled={pending} onClick={() => forget(item)}>
                      Undo
                    </Button>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      )}

      <p className="mt-10 flex gap-2.5 text-xs leading-relaxed text-ink-3">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          Found in payments since {day(historyFrom, today)}: the same merchant, a steady rhythm and similar amounts. Missing one? Open the
          payment under Transactions and choose “Track as subscription”.
        </span>
      </p>

      {shown ? (
        <DetailSheet
          item={shown}
          open={open !== null}
          byId={byId}
          today={today}
          pending={pending}
          onClose={() => setOpenKey(null)}
          onDecide={decide}
          onForget={forget}
        />
      ) : null}
    </Page>
  );
}

function Mark({ item, byId }: { item: SubscriptionItem; byId: Map<string, Category> }) {
  const c = item.categoryId ? byId.get(item.categoryId) : undefined;
  return c ? (
    <CategoryMark icon={c.icon} color={c.color} />
  ) : (
    <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-md bg-sunken text-ink-3">
      <Repeat className="size-4" strokeWidth={1.75} />
    </span>
  );
}

export function Flag({ tone, children }: { tone: "accent" | "ochre" | "quiet"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-1.5 text-[11px] font-medium leading-5",
        tone === "accent" && "bg-accent-soft text-accent",
        tone === "ochre" && "bg-ochre-soft text-ochre",
        tone === "quiet" && "bg-sunken text-ink-2",
      )}
    >
      {children}
    </span>
  );
}

function Flags({ item, today }: { item: SubscriptionItem; today: IsoDate }) {
  const flags: React.ReactNode[] = [];
  if (item.status === "new") flags.push(<Flag key="new" tone="accent">New</Flag>);
  if (item.priceIncrease) {
    flags.push(
      <Flag key="up" tone="ochre">
        Price up {kr(item.priceIncrease.toMinor - item.priceIncrease.fromMinor)}
      </Flag>,
    );
  }
  if (item.chargedAfterCancel) {
    flags.push(
      <Flag key="again" tone="ochre">
        Charged {day(item.chargedAfterCancel.date, today)}
      </Flag>,
    );
  }
  if (item.source === "manual") flags.push(<Flag key="manual" tone="quiet">Added by you</Flag>);
  return flags.length ? <span className="mt-1.5 flex flex-wrap gap-1">{flags}</span> : null;
}

function ItemText({
  item,
  byId,
  today,
  showSince = false,
}: {
  item: SubscriptionItem;
  byId: Map<string, Category>;
  today: IsoDate;
  showSince?: boolean;
}) {
  const t = timing(item, today);
  const category = item.categoryId ? byId.get(item.categoryId)?.name : null;
  const parts = [CADENCE_LABEL[item.cadence].adjective, category].filter(Boolean).join(" · ");
  return (
    <span className="min-w-0 flex-1">
      <span className="block truncate text-sm font-medium">{item.name}</span>
      <span className="mt-0.5 block truncate text-xs text-ink-2">
        {parts}
        {t ? (
          <>
            {" · "}
            <span className={t.late ? "text-ochre" : undefined}>{t.text}</span>
          </>
        ) : item.status === "cancelled" && item.cancelledOn ? (
          ` · cancelled ${day(item.cancelledOn, today)}`
        ) : null}
      </span>
      {showSince && item.firstDate && item.lastCharge ? (
        <span className="mt-0.5 block text-xs text-ink-3">
          {item.chargeCount} {item.chargeCount === 1 ? "charge" : "charges"} since {day(item.firstDate, today)}, last{" "}
          {day(item.lastCharge.date, today)}
        </span>
      ) : null}
      <Flags item={item} today={today} />
    </span>
  );
}

function ItemAmount({ item }: { item: SubscriptionItem }) {
  return (
    <span className="shrink-0 text-right">
      <span className="tnum block text-sm">
        {item.variable ? "≈ " : ""}
        {krExact(item.amountMinor)}
      </span>
      <span className="tnum mt-0.5 block text-2xs text-ink-3">
        {item.cadence === "monthly" ? "a month" : `≈ ${kr(item.monthlyMinor)}/mo`}
      </span>
    </span>
  );
}

function List({
  items,
  byId,
  today,
  onOpen,
  muted = false,
}: {
  items: SubscriptionItem[];
  byId: Map<string, Category>;
  today: IsoDate;
  onOpen: (key: string) => void;
  muted?: boolean;
}) {
  return (
    <ul className="mt-2 divide-y divide-line">
      {items.map((item) => (
        <li key={item.key}>
          <button
            type="button"
            onClick={() => onOpen(item.key)}
            className={cn("-mx-2 flex w-[calc(100%+1rem)] items-start gap-3.5 rounded-md px-2 py-3.5 text-left transition-colors hover:bg-sunken/50", muted && "opacity-70")}
          >
            <Mark item={item} byId={byId} />
            <ItemText item={item} byId={byId} today={today} />
            <ItemAmount item={item} />
          </button>
        </li>
      ))}
    </ul>
  );
}

function DetailSheet({
  item,
  open,
  byId,
  today,
  pending,
  onClose,
  onDecide,
  onForget,
}: {
  item: SubscriptionItem;
  open: boolean;
  byId: Map<string, Category>;
  today: IsoDate;
  pending: boolean;
  onClose: () => void;
  onDecide: (item: SubscriptionItem, status: Status, message: string, opts?: { acceptPrice?: boolean }) => void;
  onForget: (item: SubscriptionItem) => void;
}) {
  const category = item.categoryId ? byId.get(item.categoryId) : undefined;
  const t = timing(item, today);
  const label = CADENCE_LABEL[item.cadence];
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()} title={item.name} description={label.adjective}>
      <div className="space-y-7 pt-1">
        <div>
          <p className="tnum font-display text-2xl leading-none">
            {item.variable ? "≈ " : ""}
            {krExact(item.amountMinor)} <span className="font-sans text-sm text-ink-2">a {label.per}</span>
          </p>
          <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-xs">
            {item.cadence !== "monthly" ? (
              <>
                <dt className="text-ink-3">Per month</dt>
                <dd className="tnum">≈ {kr(item.monthlyMinor)}</dd>
              </>
            ) : null}
            <dt className="text-ink-3">Per year</dt>
            <dd className="tnum">{kr(item.annualMinor)}</dd>
            {item.range ? (
              <>
                <dt className="text-ink-3">Recently</dt>
                <dd className="tnum">
                  {kr(item.range.min)} to {kr(item.range.max)}
                </dd>
              </>
            ) : null}
            {t ? (
              <>
                <dt className="text-ink-3">{item.overdue ? "Status" : "Next charge"}</dt>
                <dd className={t.late ? "text-ochre" : undefined}>{item.overdue ? `${t.text}, may have ended` : t.text.replace(/^(Next|Expected) /, "")}</dd>
              </>
            ) : null}
            {item.cancelledOn ? (
              <>
                <dt className="text-ink-3">Cancelled</dt>
                <dd>{day(item.cancelledOn, today)}</dd>
              </>
            ) : null}
            <dt className="text-ink-3">Category</dt>
            <dd>{category?.name ?? "None yet"}</dd>
          </dl>
        </div>

        {item.priceIncrease ? (
          <div className="rounded-md bg-ochre-soft/60 px-4 py-3 text-sm">
            <p>
              The price went up from <span className="tnum">{krExact(item.priceIncrease.fromMinor)}</span> to{" "}
              <span className="tnum">{krExact(item.priceIncrease.toMinor)}</span>.
            </p>
            {item.status === "confirmed" ? (
              <Button
                variant="secondary"
                size="sm"
                className="mt-3"
                disabled={pending}
                onClick={() => onDecide(item, "confirmed", "New price saved", { acceptPrice: true })}
              >
                Accept new price
              </Button>
            ) : null}
          </div>
        ) : null}

        {item.chargedAfterCancel ? (
          <p className="rounded-md bg-ochre-soft/60 px-4 py-3 text-sm">
            Charged <span className="tnum">{krExact(item.chargedAfterCancel.amountMinor)}</span> on {day(item.chargedAfterCancel.date, today)},
            after you marked it cancelled. Worth checking with {item.name}.
          </p>
        ) : null}

        {item.recentCharges.length > 0 ? (
          <div>
            <SectionLabel>Charges</SectionLabel>
            <ul className="mt-2 divide-y divide-line text-sm">
              {item.recentCharges.map((c) => (
                <li key={c.id} className="flex justify-between py-2">
                  <span className="text-ink-2">{day(c.date, today)}</span>
                  <span className="tnum">{krExact(c.amountMinor)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-xs text-ink-3">No matching charges in your recent history yet.</p>
        )}

        <div className="grid gap-2">
          {item.status === "new" ? (
            <div className="grid grid-cols-2 gap-2">
              <Button variant="accent" disabled={pending} onClick={() => onDecide(item, "confirmed", `Tracking ${item.name}`)}>
                Yes, track it
              </Button>
              <Button variant="secondary" disabled={pending} onClick={() => onDecide(item, "dismissed", `${item.name} hidden`)}>
                Not a subscription
              </Button>
            </div>
          ) : null}
          {item.status === "confirmed" ? (
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" disabled={pending} onClick={() => onDecide(item, "cancelled", `${item.name} marked as cancelled`)}>
                I cancelled it
              </Button>
              <Button variant="secondary" disabled={pending} onClick={() => onDecide(item, "dismissed", `${item.name} hidden`)}>
                Not a subscription
              </Button>
            </div>
          ) : null}
          {item.status === "cancelled" ? (
            <Button variant="secondary" disabled={pending} onClick={() => onDecide(item, "confirmed", `${item.name} is active again`)}>
              It is still active
            </Button>
          ) : null}
          {item.decisionId && item.source === "manual" ? (
            <Button variant="quiet" disabled={pending} onClick={() => onForget(item)}>
              Stop tracking
            </Button>
          ) : null}
          <Button variant="secondary" block onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
