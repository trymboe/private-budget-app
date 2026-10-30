"use client";

import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import type { NameType, ValueType } from "recharts/types/component/DefaultTooltipContent";
import { CategoryMark } from "@/components/category-icon";
import type { MonthPerformance } from "@/lib/budget";
import type { CategoryTrend } from "@/lib/data/insights";
import { formatMonth } from "@/lib/dates";
import { formatMoney } from "@/lib/money";

// Chart conventions (see docs/DESIGN.md): one axis, thin marks, 2px lines,
// recessive grid, tooltips on hover/tap, a legend whenever there are two series,
// and a table view for every chart. Colour never carries meaning alone: under/over
// budget is also encoded by direction from the zero line.

const kr = (minor: number) => formatMoney(minor, "NOK", { decimals: "never" });
const compact = (minor: number) => {
  const kroner = Math.round(minor / 100);
  if (Math.abs(kroner) >= 1000) return `${Math.round(kroner / 100) / 10}k`.replace(".", ",");
  return String(kroner);
};

const AXIS = { stroke: "var(--ink-3)", fontSize: 11, tickLine: false, axisLine: false } as const;

function TooltipBox({ title, rows }: { title: string; rows: { label: string; value: string; swatch?: string }[] }) {
  return (
    <div className="rounded-md bg-surface px-3 py-2 text-xs shadow-[0_8px_24px_-10px_rgba(0,0,0,0.35)] ring-1 ring-line">
      <p className="font-medium text-ink">{title}</p>
      {rows.map((r) => (
        <p key={r.label} className="mt-1 flex items-center justify-between gap-4 text-ink-2">
          <span className="flex items-center gap-1.5">
            {r.swatch ? <span className="inline-block h-0.5 w-3 rounded-full" style={{ backgroundColor: r.swatch }} /> : null}
            {r.label}
          </span>
          <span className="tnum text-ink">{r.value}</span>
        </p>
      ))}
    </div>
  );
}

/** Monthly budget variance: bars above zero = under budget, below = over. */
export function VarianceChart({ months }: { months: MonthPerformance[] }) {
  const data = months.map((m) => ({ ...m, label: formatMonth(m.month, { short: true }) }));
  return (
    <div className="h-56 w-full" role="img" aria-label="Monthly budget variance. A table with the same numbers follows.">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -8 }} barCategoryGap="28%">
          <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="0" />
          <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" />
          <YAxis {...AXIS} width={44} tickFormatter={compact} />
          <ReferenceLine y={0} stroke="var(--ink-3)" />
          <Tooltip
            cursor={{ fill: "var(--sunken)", opacity: 0.6 }}
            content={(p: TooltipContentProps<ValueType, NameType>) => {
              const m = p.payload?.[0]?.payload as (MonthPerformance & { label: string }) | undefined;
              if (!p.active || !m) return null;
              return (
                <TooltipBox
                  title={`${formatMonth(m.month, { year: true })}${m.partial ? " · incomplete" : ""}`}
                  rows={[
                    { label: "Budget", value: kr(m.budget) },
                    { label: "Spent", value: kr(m.spent) },
                    { label: m.variance >= 0 ? "Under budget" : "Over budget", value: kr(Math.abs(m.variance)) },
                  ]}
                />
              );
            }}
          />
          <Bar dataKey="variance" radius={[4, 4, 4, 4]} maxBarSize={28} isAnimationActive={false}>
            {data.map((m) => (
              <Cell
                key={m.month}
                fill={m.variance >= 0 ? "var(--under)" : "var(--over)"}
                fillOpacity={m.partial ? 0.35 : 1}
                stroke={m.partial ? (m.variance >= 0 ? "var(--under)" : "var(--over)") : undefined}
                strokeDasharray={m.partial ? "3 2" : undefined}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Cumulative spending through the month: this month vs last month, with the budget as a reference. */
export function PaceChart({
  data,
  budget,
  thisLabel,
  lastLabel,
}: {
  data: { day: number; thisMonth: number | null; lastMonth: number | null }[];
  budget: number;
  thisLabel: string;
  lastLabel: string;
}) {
  return (
    <div>
      <ul className="mb-3 flex gap-5 text-xs text-ink-2" aria-label="Legend">
        <li className="flex items-center gap-2">
          <span className="h-0.5 w-4 rounded-full bg-ink" aria-hidden /> {thisLabel}
        </li>
        <li className="flex items-center gap-2">
          <span className="h-0.5 w-4 rounded-full bg-ink-3" aria-hidden /> {lastLabel}
        </li>
        {budget > 0 ? (
          <li className="flex items-center gap-2">
            <span className="w-4 border-t border-dashed border-ink-3" aria-hidden /> Budget
          </li>
        ) : null}
      </ul>
      <div className="h-52 w-full" role="img" aria-label={`Cumulative spending by day, ${thisLabel} compared with ${lastLabel}.`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
            <CartesianGrid vertical={false} stroke="var(--line)" />
            <XAxis dataKey="day" {...AXIS} ticks={[1, 8, 15, 22, 29]} />
            <YAxis {...AXIS} width={44} tickFormatter={compact} />
            {budget > 0 ? <ReferenceLine y={budget} stroke="var(--ink-3)" strokeDasharray="4 4" /> : null}
            <Tooltip
              cursor={{ stroke: "var(--line-strong)" }}
              content={(p: TooltipContentProps<ValueType, NameType>) => {
                const row = p.payload?.[0]?.payload as { day: number; thisMonth: number | null; lastMonth: number | null } | undefined;
                if (!p.active || !row) return null;
                const rows = [];
                if (row.thisMonth !== null) rows.push({ label: thisLabel, value: kr(row.thisMonth), swatch: "var(--ink)" });
                if (row.lastMonth !== null) rows.push({ label: lastLabel, value: kr(row.lastMonth), swatch: "var(--ink-3)" });
                return <TooltipBox title={`Day ${row.day}`} rows={rows} />;
              }}
            />
            <Line type="monotone" dataKey="lastMonth" stroke="var(--ink-3)" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
            <Line type="monotone" dataKey="thisMonth" stroke="var(--ink)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** One category at a time: monthly spending against that month's budget. */
export function CategoryTrends({ trends }: { trends: CategoryTrend[] }) {
  const [id, setId] = useState(trends[0]?.category.id);
  const trend = trends.find((t) => t.category.id === id) ?? trends[0];
  if (!trend) return null;
  const data = trend.months.map((m) => ({ ...m, label: formatMonth(m.month, { short: true }) }));
  const hasBudget = data.some((m) => m.budget > 0);

  return (
    <div>
      <div className="-mx-5 mb-4 flex gap-1.5 overflow-x-auto px-5 pb-1 [scrollbar-width:none] sm:-mx-8 sm:px-8">
        {trends.slice(0, 10).map((t) => (
          <button
            key={t.category.id}
            type="button"
            onClick={() => setId(t.category.id)}
            aria-pressed={t.category.id === trend.category.id}
            className={
              t.category.id === trend.category.id
                ? "flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-ink pr-3.5 pl-1.5 text-xs font-medium text-paper"
                : "flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-surface pr-3.5 pl-1.5 text-xs text-ink-2 ring-1 ring-inset ring-line"
            }
          >
            <CategoryMark icon={t.category.icon} color={t.category.color} size="sm" />
            {t.category.name}
          </button>
        ))}
      </div>
      <p className="mb-3 text-xs text-ink-2">
        Average {kr(trend.average)} a month{hasBudget ? "; dashed line is that month’s budget." : "."}
      </p>
      <div className="h-48 w-full" role="img" aria-label={`Monthly spending on ${trend.category.name}.`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -8 }} barCategoryGap="28%">
            <CartesianGrid vertical={false} stroke="var(--line)" />
            <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" />
            <YAxis {...AXIS} width={44} tickFormatter={compact} />
            <Tooltip
              cursor={{ fill: "var(--sunken)", opacity: 0.6 }}
              content={(p: TooltipContentProps<ValueType, NameType>) => {
                const m = p.payload?.[0]?.payload as { month: string; spent: number; budget: number } | undefined;
                if (!p.active || !m) return null;
                return (
                  <TooltipBox
                    title={formatMonth(m.month, { year: true })}
                    rows={[{ label: "Spent", value: kr(m.spent) }, ...(m.budget > 0 ? [{ label: "Budget", value: kr(m.budget) }] : [])]}
                  />
                );
              }}
            />
            <Bar dataKey="spent" fill="var(--ink-2)" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
            {hasBudget ? (
              <Line type="stepAfter" dataKey="budget" stroke="var(--ink-3)" strokeDasharray="4 4" strokeWidth={1.5} dot={false} />
            ) : null}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
