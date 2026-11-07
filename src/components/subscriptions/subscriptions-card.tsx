import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getSubscriptionsView } from "@/lib/data/subscriptions";
import { formatMoney } from "@/lib/money";
import type { SubscriptionTotals } from "@/lib/subscriptions";

/**
 * Home card: "Subscriptions · 1 240 kr a month · 1 new". Loads its own data so
 * Home needs only one line to show it, and stays out of the way when there is
 * nothing to show or the data cannot be loaded.
 */
export async function SubscriptionsCard() {
  let totals: SubscriptionTotals;
  try {
    ({ totals } = await getSubscriptionsView());
  } catch {
    return null;
  }
  return <SubscriptionsCardView totals={totals} />;
}

export function SubscriptionsCardView({ totals }: { totals: SubscriptionTotals }) {
  if (totals.activeCount === 0 && totals.newCount === 0) return null;
  const extras = [
    totals.newCount > 0 ? `${totals.newCount} new` : null,
    totals.priceIncreaseCount > 0 ? `${totals.priceIncreaseCount} price ${totals.priceIncreaseCount === 1 ? "increase" : "increases"}` : null,
  ].filter(Boolean);
  return (
    <Link
      href="/subscriptions"
      className="flex items-center justify-between gap-4 rounded-lg px-5 py-4 ring-1 ring-inset ring-line transition-colors hover:bg-sunken/50"
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium">Subscriptions</span>
        <span className="mt-0.5 block text-xs text-ink-2">
          <span className="tnum">{formatMoney(totals.monthlyMinor, "NOK", { decimals: "never" })}</span> a month
          {extras.length > 0 ? (
            <>
              {" · "}
              <span className="text-accent">{extras.join(", ")}</span>
            </>
          ) : null}
        </span>
      </span>
      <ArrowRight className="size-5 shrink-0 text-ink-2" aria-hidden />
    </Link>
  );
}
