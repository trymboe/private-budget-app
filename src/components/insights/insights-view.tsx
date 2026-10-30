import Link from "next/link";
import { CategoryTrends, PaceChart, VarianceChart } from "@/components/insights/charts";
import { EmptyState, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/ui/field";
import type { Insights } from "@/lib/data/insights";
import { addMonths, formatMonth } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

const kr = (minor: number) => formatMoney(minor, "NOK", { decimals: "never" });

/** Insights presentation; all data arrives as one prop. */
export function InsightsView({ data }: { data: Insights }) {
  const complete = data.performance.filter((m) => !m.partial);
  const hasHistory = data.performance.length > 0;
  const thisLabel = formatMonth(data.currentMonth);
  const lastLabel = formatMonth(addMonths(data.currentMonth, -1));

  return (
    <Page wide>
      <PageHeader title="Insights" />
      {!hasHistory && data.trends.length === 0 ? (
        <EmptyState
          title="Not enough history yet."
          action={
            <Button asChild variant="secondary">
              <Link href="/budget">Set a budget</Link>
            </Button>
          }
        >
          Insights appear once you have a budget and a month or two of categorised transactions.
        </EmptyState>
      ) : (
        <div className="grid gap-x-16 gap-y-14 lg:grid-cols-2 [&>section]:min-w-0">
          <section aria-labelledby="perf" className="lg:col-span-2">
            <SectionLabel id="perf">Budget performance</SectionLabel>
            <div className="mt-4 flex flex-wrap items-end gap-x-12 gap-y-4">
              <div>
                <p className={cn("tnum font-display text-2xl leading-none", data.cumulativeVariance < 0 && "text-over")}>
                  {kr(Math.abs(data.cumulativeVariance))}
                </p>
                <p className="mt-2 text-xs text-ink-2">
                  {data.cumulativeVariance >= 0 ? "under budget" : "over budget"} in total across {data.completeMonths} complete{" "}
                  {data.completeMonths === 1 ? "month" : "months"}
                </p>
              </div>
              {data.completeMonths > 0 ? (
                <div>
                  <p className="tnum font-display text-2xl leading-none">{kr(data.averageSpent)}</p>
                  <p className="mt-2 text-xs text-ink-2">average monthly spending</p>
                </div>
              ) : null}
            </div>
            {hasHistory ? (
              <>
                <div className="mt-8">
                  <VarianceChart months={data.performance} />
                </div>
                <p className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-2xs text-ink-3">
                  <span className="flex items-center gap-1.5">
                    <span className="size-2.5 rounded-[3px] bg-under" aria-hidden /> Under budget (above the line)
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="size-2.5 rounded-[3px] bg-over" aria-hidden /> Over budget (below the line)
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="size-2.5 rounded-[3px] border border-dashed border-ink-3" aria-hidden /> Incomplete month, not in totals
                  </span>
                </p>
                <details className="mt-5 text-sm">
                  <summary className="cursor-pointer text-xs text-ink-2 hover:text-ink">Show as table</summary>
                  <table className="tnum mt-3 w-full text-xs">
                    <thead className="text-left text-ink-3">
                      <tr>
                        <th className="py-1.5 font-medium">Month</th>
                        <th className="py-1.5 text-right font-medium">Budget</th>
                        <th className="py-1.5 text-right font-medium">Spent</th>
                        <th className="py-1.5 text-right font-medium">Difference</th>
                        <th className="py-1.5 text-right font-medium">Running total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {data.performance.map((m) => (
                        <tr key={m.month}>
                          <td className="py-1.5">
                            {formatMonth(m.month, { year: true })}
                            {m.partial ? <span className="text-ink-3"> · incomplete</span> : null}
                          </td>
                          <td className="py-1.5 text-right">{kr(m.budget)}</td>
                          <td className="py-1.5 text-right">{kr(m.spent)}</td>
                          <td className={cn("py-1.5 text-right", m.variance < 0 && "text-over")}>
                            {m.variance >= 0 ? `${kr(m.variance)} under` : `${kr(-m.variance)} over`}
                            {m.budget > 0 ? <span className="text-ink-3"> ({m.deviationPercent > 0 ? "+" : ""}{m.deviationPercent}%)</span> : null}
                          </td>
                          <td className="py-1.5 text-right">{m.partial ? "–" : kr(m.cumulativeVariance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
                {complete.length === 0 ? (
                  <p className="mt-4 text-xs text-ink-3">The running total starts with your first complete month.</p>
                ) : null}
              </>
            ) : null}
          </section>

          <section aria-labelledby="pace">
            <SectionLabel id="pace">Spending through the month</SectionLabel>
            <div className="mt-5">
              <PaceChart data={data.pace} budget={data.thisMonthBudget} thisLabel={thisLabel} lastLabel={lastLabel} />
            </div>
          </section>

          {data.trends.length > 0 ? (
            <section aria-labelledby="trends">
              <SectionLabel id="trends">By category</SectionLabel>
              <div className="mt-5">
                <CategoryTrends trends={data.trends} />
              </div>
            </section>
          ) : null}

          <section aria-labelledby="cash" className="lg:col-span-2">
            <SectionLabel id="cash">Cash flow</SectionLabel>
            <p className="mt-2 max-w-prose text-xs text-ink-2">
              Everything that came in minus everything that went out, regardless of categories or budget. Transfers between your own
              accounts and excluded transactions are left out. This is not the same as budget variance above.
            </p>
            <table className="tnum mt-4 w-full max-w-2xl text-xs">
              <thead className="text-left text-ink-3">
                <tr>
                  <th className="py-1.5 font-medium">Month</th>
                  <th className="py-1.5 text-right font-medium">In</th>
                  <th className="py-1.5 text-right font-medium">Out</th>
                  <th className="py-1.5 text-right font-medium">Net</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {[...data.cashFlow].reverse().map((m) => (
                  <tr key={m.month}>
                    <td className="py-2">
                      {formatMonth(m.month, { year: true })}
                      {m.partial ? <span className="text-ink-3"> · incomplete</span> : null}
                    </td>
                    <td className="py-2 text-right">{kr(m.inflow)}</td>
                    <td className="py-2 text-right">{kr(m.outflow)}</td>
                    <td className={cn("py-2 text-right font-medium", m.net < 0 ? "text-over" : "text-ink")}>
                      {m.net >= 0 ? "+" : "−"}
                      {kr(Math.abs(m.net))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      )}
    </Page>
  );
}
