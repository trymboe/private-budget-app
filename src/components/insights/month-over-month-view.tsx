import Link from "next/link";
import { Info } from "lucide-react";
import { InsightsTabs } from "@/components/insights/insights-tabs";
import { CategoryRows, CompactTable, TotalChart } from "@/components/insights/month-over-month-charts";
import { EmptyState, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/ui/field";
import type { MonthOverMonthData } from "@/lib/data/month-over-month";
import { formatMonth } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { MONTH_RANGES, varianceText, type MonthCell } from "@/lib/month-over-month";
import { cn } from "@/lib/utils";

const kr = (minor: number) => formatMoney(minor, "NOK", { decimals: "never" });

/** Budget vs actual for the last 3, 6 or 12 months, in total and per category. */
export function MonthOverMonthView({ data }: { data: MonthOverMonthData }) {
  // Months before you started carry no information; start at the first useful one.
  const start = Math.max(0, data.columns.findIndex((c) => c.status !== "empty"));
  const trim = (cells: MonthCell[]) => cells.slice(start);
  const total = { ...data.total, cells: trim(data.total.cells) };
  const rows = data.rows.map((r) => ({ ...r, cells: trim(r.cells) }));
  const columns = data.columns.slice(start);
  const trimmed = start > 0;
  const partial = columns.filter((c) => c.status === "partial");
  const unreviewed = columns.filter((c) => data.unreviewed[c.month]);
  const hasData = rows.length > 0;

  return (
    <Page wide>
      <PageHeader title="Insights" />
      <InsightsTabs active="months" />

      <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-2">Budget vs spent, month by month</p>
        <nav aria-label="How many months" className="flex gap-1.5">
          {MONTH_RANGES.map((n) => (
            <Link
              key={n}
              href={`/insights/months?range=${n}`}
              aria-current={n === data.range ? "page" : undefined}
              className={cn(
                "flex h-9 min-w-11 items-center justify-center rounded-full px-3.5 text-xs",
                n === data.range ? "bg-ink font-medium text-paper" : "bg-surface text-ink-2 ring-1 ring-inset ring-line hover:text-ink",
              )}
            >
              {n} months
            </Link>
          ))}
        </nav>
      </div>

      {!hasData ? (
        <EmptyState
          title="Nothing to compare yet."
          action={
            <Button asChild variant="secondary">
              <Link href="/budget">Set a budget</Link>
            </Button>
          }
        >
          Month over month appears once you have a budget or categorised spending in the last {data.range} months.
        </EmptyState>
      ) : (
        <div className="grid gap-y-14 [&>section]:min-w-0">
          <section aria-labelledby="mom-total">
            <SectionLabel id="mom-total">All categories</SectionLabel>
            <div className="mt-4 grid grid-cols-3 items-start gap-x-4 gap-y-4 sm:flex sm:flex-wrap sm:items-end sm:gap-x-12">
              {total.completeMonths > 0 ? (
                <>
                  <div>
                    <p className={cn("tnum font-display text-lg sm:text-2xl leading-none", total.averageVariance < 0 && "text-over")}>
                      {total.averageVariance === 0 ? "On budget" : kr(Math.abs(total.averageVariance))}
                    </p>
                    <p className="mt-2 text-xs text-ink-2">
                      {total.averageVariance === 0 ? "on average" : total.averageVariance > 0 ? "under budget on average" : "over budget on average"}
                    </p>
                  </div>
                  <div>
                    <p className="tnum font-display text-lg sm:text-2xl leading-none">{kr(total.averageSpent)}</p>
                    <p className="mt-2 text-xs text-ink-2">spent a month, budget {kr(total.averageBudget)}</p>
                  </div>
                  <div>
                    <p className="tnum font-display text-lg sm:text-2xl leading-none">
                      {total.overMonths}
                      <span className="text-sm text-ink-3 sm:text-base"> / {total.completeMonths}</span>
                    </p>
                    <p className="mt-2 text-xs text-ink-2">months over budget</p>
                  </div>
                </>
              ) : (
                <p className="col-span-3 text-sm text-ink-2">No complete month in this range yet, so there is no average to show.</p>
              )}
            </div>
            <div className="mt-8">
              <TotalChart cells={total.cells} />
            </div>
            <details className="mt-5 text-sm">
              <summary className="cursor-pointer text-xs text-ink-2 hover:text-ink">Show as table</summary>
              <table className="tnum mt-3 w-full max-w-2xl text-xs">
                <thead className="text-left text-ink-3">
                  <tr>
                    <th className="py-1.5 font-medium">Month</th>
                    <th className="py-1.5 text-right font-medium">Budget</th>
                    <th className="py-1.5 text-right font-medium">Spent</th>
                    <th className="py-1.5 text-right font-medium">Difference</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {[...total.cells].reverse().map((c) => (
                    <tr key={c.month}>
                      <td className="py-1.5">
                        {formatMonth(c.month, { year: true })}
                        {c.status === "current" ? <span className="text-ink-3"> · so far</span> : null}
                        {c.status === "partial" ? <span className="text-ink-3"> · incomplete</span> : null}
                      </td>
                      <td className="py-1.5 text-right">{kr(c.budget)}</td>
                      <td className="py-1.5 text-right">{kr(c.spent)}</td>
                      <td className={cn("py-1.5 text-right", c.variance < 0 && c.status === "complete" && "text-over")}>{varianceText(c)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </section>

          <section aria-labelledby="mom-cats">
            <SectionLabel id="mom-cats">By category</SectionLabel>
            <p className="mt-2 mb-4 text-xs text-ink-2">Tap a category to see each month.</p>
            <CategoryRows rows={rows} columns={total.cells} />
          </section>

          <section aria-labelledby="mom-table">
            <SectionLabel id="mom-table">Every month at a glance</SectionLabel>
            <p className="mt-2 mb-4 text-xs text-ink-2">
              Spent in kroner, and under it the difference to budget: + under, − over. Swipe sideways for more months.
            </p>
            <CompactTable rows={rows} total={total} />
          </section>

          <ul className="space-y-2 text-xs text-ink-2">
            <li className="flex gap-2">
              <Info className="mt-0.5 size-3.5 shrink-0 text-ink-3" aria-hidden />
              <span>
                {formatMonth(data.currentMonth)} is still running, so it is shown as “so far” and left out of averages.
                {partial.length > 0
                  ? ` Your bank did not provide all of ${partial.map((c) => formatMonth(c.month, { year: true })).join(", ")}, so ${partial.length === 1 ? "it is" : "they are"} marked incomplete and left out too.`
                  : ""}
              </span>
            </li>
            {trimmed ? (
              <li className="flex gap-2">
                <Info className="mt-0.5 size-3.5 shrink-0 text-ink-3" aria-hidden />
                <span>Your history here starts in {formatMonth(columns[0].month, { year: true })}; earlier months had no budget or spending.</span>
              </li>
            ) : null}
            {unreviewed.length > 0 ? (
              <li className="flex gap-2">
                <Info className="mt-0.5 size-3.5 shrink-0 text-ink-3" aria-hidden />
                <span>
                  Transactions waiting for review are not in these totals yet (
                  {unreviewed.map((c) => `${formatMonth(c.month, { short: true })}: ${data.unreviewed[c.month].count}`).join(", ")}).{" "}
                  <Link href="/review" className="underline underline-offset-4">
                    Review them
                  </Link>
                </span>
              </li>
            ) : null}
          </ul>
        </div>
      )}
    </Page>
  );
}
