"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import type { NameType, ValueType } from "recharts/types/component/DefaultTooltipContent";
import { CategoryMark } from "@/components/category-icon";
import type { Category } from "@/lib/data/types";
import { formatMonth } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { STATUS_NOTE, varianceText, type MonthCell, type MonthOverMonthRow } from "@/lib/month-over-month";
import { cn } from "@/lib/utils";

// Month over month, budget vs actual. Same conventions as charts.tsx: one axis,
// recessive grid, blue under / orange over (never colour alone: words in every
// row and tooltip), incomplete months faded with a dashed outline.

const kr = (minor: number) => formatMoney(minor, "NOK", { decimals: "never" });
const compact = (minor: number) => {
  const kroner = Math.round(minor / 100);
  if (Math.abs(kroner) >= 1000) return `${Math.round(kroner / 100) / 10}k`.replace(".", ",");
  return String(kroner);
};
const AXIS = { stroke: "var(--ink-3)", fontSize: 11, tickLine: false, axisLine: false } as const;

const tone = (variance: number) => (variance >= 0 ? "var(--under)" : "var(--over)");
const judged = (c: MonthCell) => c.status === "complete";

/** Total budget vs spent per month: paired bars, spent coloured by the result. */
export function TotalChart({ cells }: { cells: MonthCell[] }) {
  const data = cells.map((c) => ({ ...c, label: formatMonth(c.month, { short: true }) }));
  return (
    <div>
      <ul className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-2xs text-ink-2" aria-label="Legend">
        <li className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px] bg-line-strong" aria-hidden /> Budget
        </li>
        <li className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px] bg-under" aria-hidden /> Spent, within budget
        </li>
        <li className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px] bg-over" aria-hidden /> Spent, over budget
        </li>
        <li className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px] border border-dashed border-ink-3" aria-hidden /> Incomplete, not in averages
        </li>
      </ul>
      <div className="h-56 w-full" role="img" aria-label="Total budget and spending per month. A table with the same numbers follows.">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -8 }} barCategoryGap="22%" barGap={2}>
            <CartesianGrid vertical={false} stroke="var(--line)" />
            <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" />
            <YAxis {...AXIS} width={44} tickFormatter={compact} />
            <Tooltip
              cursor={{ fill: "var(--sunken)", opacity: 0.6 }}
              content={(p: TooltipContentProps<ValueType, NameType>) => {
                const c = p.payload?.[0]?.payload as (MonthCell & { label: string }) | undefined;
                if (!p.active || !c) return null;
                const note = STATUS_NOTE[c.status];
                return (
                  <div className="rounded-md bg-surface px-3 py-2 text-xs shadow-[0_8px_24px_-10px_rgba(0,0,0,0.35)] ring-1 ring-line">
                    <p className="font-medium text-ink">
                      {formatMonth(c.month, { year: true })}
                      {note ? <span className="font-normal text-ink-3"> · {note}</span> : null}
                    </p>
                    <p className="mt-1 flex justify-between gap-4 text-ink-2">
                      Budget <span className="tnum text-ink">{kr(c.budget)}</span>
                    </p>
                    <p className="mt-1 flex justify-between gap-4 text-ink-2">
                      Spent <span className="tnum text-ink">{kr(c.spent)}</span>
                    </p>
                    <p className={cn("tnum mt-1 text-right", c.variance < 0 ? "text-over" : "text-ink-2")}>{varianceText(c)}</p>
                  </div>
                );
              }}
            />
            <Bar dataKey="budget" fill="var(--line-strong)" radius={[3, 3, 0, 0]} maxBarSize={18} isAnimationActive={false} />
            <Bar dataKey="spent" radius={[3, 3, 0, 0]} maxBarSize={18} isAnimationActive={false}>
              {data.map((c) => (
                <Cell
                  key={c.month}
                  fill={tone(c.variance)}
                  fillOpacity={judged(c) ? 1 : 0.35}
                  stroke={judged(c) ? undefined : tone(c.variance)}
                  strokeDasharray={judged(c) ? undefined : "3 2"}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Small per-month bars for one row: spent as a bar, that month's budget as a tick. */
function MiniBars({ cells }: { cells: MonthCell[] }) {
  const max = Math.max(1, ...cells.map((c) => Math.max(c.spent, c.budget, 0)));
  return (
    <div className="grid h-9 items-end gap-1" style={{ gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))` }} aria-hidden>
      {cells.map((c) => {
        const h = (Math.max(c.spent, 0) / max) * 100;
        const b = (Math.max(c.budget, 0) / max) * 100;
        return (
          <div key={c.month} className="relative h-full">
            <div
              className={cn("absolute inset-x-0 bottom-0 rounded-t-[2px]", !judged(c) && "border border-dashed")}
              style={{
                height: `${Math.max(h, c.spent > 0 ? 4 : 0)}%`,
                backgroundColor: `color-mix(in oklab, ${tone(c.variance)} ${judged(c) ? 100 : 35}%, transparent)`,
                borderColor: judged(c) ? undefined : tone(c.variance),
              }}
            />
            {c.budget > 0 ? <div className="absolute -inset-x-px h-0.5 rounded-full bg-ink" style={{ bottom: `calc(${b}% - 1px)` }} /> : null}
          </div>
        );
      })}
    </div>
  );
}

function MonthLabels({ cells }: { cells: MonthCell[] }) {
  return (
    <div className="tnum grid gap-1 text-center text-[10px] leading-none text-ink-3" style={{ gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))` }} aria-hidden>
      {cells.map((c) => (
        <span key={c.month} className="truncate">
          {cells.length > 7 ? formatMonth(c.month, { short: true }).slice(0, 1) : formatMonth(c.month, { short: true })}
        </span>
      ))}
    </div>
  );
}

function MonthTable({ cells }: { cells: MonthCell[] }) {
  return (
    <table className="tnum w-full text-xs">
      <thead className="text-left text-ink-3">
        <tr>
          <th className="py-1.5 font-medium">Month</th>
          <th className="py-1.5 text-right font-medium">Budget</th>
          <th className="py-1.5 text-right font-medium">Spent</th>
          <th className="py-1.5 text-right font-medium">Difference</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {[...cells].reverse().map((c) => {
          const note = STATUS_NOTE[c.status];
          return (
            <tr key={c.month} className={cn(!judged(c) && "text-ink-2")}>
              <td className="py-2">
                {formatMonth(c.month, { short: true, year: true })}
                {note ? <span className="block text-2xs text-ink-3">{note}</span> : null}
              </td>
              <td className="py-2 text-right">{kr(c.budget)}</td>
              <td className="py-2 text-right">{kr(c.spent)}</td>
              <td className={cn("py-2 text-right", c.variance < 0 && judged(c) && "text-over")}>{varianceText(c)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function summaryLine(r: { completeMonths: number; averageVariance: number; overMonths: number; averageBudget: number; averageSpent: number }) {
  if (r.completeMonths === 0) return "No complete months yet";
  const avg = varianceText({ variance: r.averageVariance, budget: r.averageBudget, spent: r.averageSpent });
  const over = r.overMonths === 0 ? "never over" : `over in ${r.overMonths} of ${r.completeMonths}`;
  return `Avg ${avg} · ${over}`;
}

/** One row per category: name, average, small per-month bars; tap for the months in detail. */
export function CategoryRows({ rows, columns }: { rows: MonthOverMonthRow<Category>[]; columns: MonthCell[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div>
      <div className="flex items-center justify-between gap-4 border-b border-line pb-2 text-2xs text-ink-3">
        <span>Bar is spent, line is that month’s budget</span>
        <span>Avg spent</span>
      </div>
      <div className="pt-2 pl-9 pr-7">
        <MonthLabels cells={columns} />
      </div>
      <ul className="divide-y divide-line">
        {rows.map((r) => {
          const isOpen = open === r.category.id;
          const panel = `mom-${r.category.id}`;
          return (
            <li key={r.category.id}>
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : r.category.id)}
                aria-expanded={isOpen}
                aria-controls={panel}
                className="-mx-2 block w-[calc(100%+1rem)] rounded-md px-2 py-3 text-left hover:bg-sunken/50"
              >
                <span className="flex items-center gap-3">
                  <CategoryMark icon={r.category.icon} color={r.category.color} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {r.category.name}
                      {r.category.archived ? <span className="font-normal text-ink-3"> · archived</span> : null}
                    </span>
                    <span className={cn("block text-2xs", r.completeMonths > 0 && r.averageVariance < 0 ? "text-over" : "text-ink-2")}>
                      {summaryLine(r)}
                    </span>
                  </span>
                  <span className="tnum shrink-0 text-right text-sm">{r.completeMonths > 0 ? kr(r.averageSpent) : "–"}</span>
                  <ChevronDown className={cn("size-4 shrink-0 text-ink-3 transition-transform duration-200", isOpen && "rotate-180")} aria-hidden />
                </span>
                <span className="mt-2.5 block pl-9 pr-7">
                  <MiniBars cells={r.cells} />
                </span>
              </button>
              {isOpen ? (
                <div id={panel} className="pb-4 pl-9">
                  <MonthTable cells={r.cells} />
                  {r.completeMonths > 0 ? (
                    <p className="tnum mt-3 text-2xs text-ink-2">
                      Average over {r.completeMonths} complete {r.completeMonths === 1 ? "month" : "months"}: budget {kr(r.averageBudget)}, spent{" "}
                      {kr(r.averageSpent)}. In total {r.totalVariance >= 0 ? `${kr(r.totalVariance)} under` : `${kr(-r.totalVariance)} over`}.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Every category and month at once: compact, horizontally scrollable, category column pinned. */
export function CompactTable({ rows, total }: { rows: MonthOverMonthRow<Category>[]; total: { cells: MonthCell[]; averageSpent: number; averageVariance: number; averageBudget: number; completeMonths: number } }) {
  const columns = total.cells;
  const cell = (c: MonthCell) => (
    <td key={c.month} className={cn("px-2 py-2 text-right align-top", !judged(c) && "text-ink-3")}>
      <span className="block">{compact(c.spent)}</span>
      <span className={cn("block text-[10px]", judged(c) && c.variance < 0 ? "text-over" : "text-ink-3")}>
        {c.budget === 0 && c.spent === 0 ? "–" : c.variance === 0 ? "±0" : `${c.variance > 0 ? "+" : "−"}${compact(Math.abs(c.variance))}`}
      </span>
    </td>
  );
  const avg = (r: { averageSpent: number; averageVariance: number; completeMonths: number }) => (
    <td className="border-l border-line px-2 py-2 text-right align-top font-medium">
      {r.completeMonths > 0 ? (
        <>
          <span className="block">{compact(r.averageSpent)}</span>
          <span className={cn("block text-[10px] font-normal", r.averageVariance < 0 ? "text-over" : "text-ink-3")}>
            {r.averageVariance === 0 ? "±0" : `${r.averageVariance > 0 ? "+" : "−"}${compact(Math.abs(r.averageVariance))}`}
          </span>
        </>
      ) : (
        "–"
      )}
    </td>
  );
  return (
    <div className="-mx-5 overflow-x-auto px-5 sm:-mx-8 sm:px-8">
      <table className="tnum w-max min-w-full text-xs">
        <caption className="sr-only">Spent per category and month in kroner, with the difference to budget (+ under, − over).</caption>
        <thead className="text-ink-3">
          <tr>
            <th className="sticky left-0 z-10 bg-paper py-1.5 pr-3 text-left font-medium">Category</th>
            {columns.map((c) => (
              <th key={c.month} className="px-2 py-1.5 text-right font-medium">
                {formatMonth(c.month, { short: true })}
                {judged(c) ? null : <span className="block text-[10px] font-normal">{STATUS_NOTE[c.status]}</span>}
              </th>
            ))}
            <th className="border-l border-line px-2 py-1.5 text-right font-medium">Avg</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.category.id}>
              <th scope="row" className="sticky left-0 z-10 max-w-28 truncate bg-paper py-2 pr-3 text-left align-top font-normal">
                {r.category.name}
              </th>
              {r.cells.map(cell)}
              {avg(r)}
            </tr>
          ))}
          <tr className="border-t border-line-strong font-medium">
            <th scope="row" className="sticky left-0 z-10 bg-paper py-2 pr-3 text-left align-top font-medium">
              Total
            </th>
            {total.cells.map(cell)}
            {avg(total)}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
