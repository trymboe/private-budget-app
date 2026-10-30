import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { BudgetEditor } from "@/components/budget/budget-editor";
import { EmptyState, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { getMonthBudgets, getMonthView, getToday } from "@/lib/data/queries";
import { addMonths, formatMonth, isValidMonthParam, monthStart } from "@/lib/dates";

export const metadata: Metadata = { title: "Budget" };

export default async function BudgetPage({ searchParams }: { searchParams: Promise<{ month?: string; edit?: string }> }) {
  const { month: param, edit } = await searchParams;
  const today = await getToday();
  const current = monthStart(today);
  let month = isValidMonthParam(param) ? `${param}-01` : current;
  // Plan up to a year ahead; look back as far as you like.
  if (month > addMonths(current, 12)) month = current;

  const previous = addMonths(month, -1);
  const [view, previousBudgets] = await Promise.all([getMonthView(month), getMonthBudgets(previous)]);
  const expense = view.categories.filter((c) => c.kind === "expense" && !c.archived);
  const budgets = Object.fromEntries(view.summary.lines.map((l) => [l.category.id, l.budget]));
  const spent = Object.fromEntries(view.summary.lines.map((l) => [l.category.id, l.spent]));
  // Past months are read-only so history cannot be rewritten by accident;
  // the current month and future months are editable.
  const editable = month >= current || edit === "1";

  return (
    <Page>
      <PageHeader
        title="Budget"
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href="/budget/categories">Categories</Link>
          </Button>
        }
      />

      <nav aria-label="Month" className="mb-8 flex items-center justify-between rounded-lg bg-surface px-2 py-1.5 ring-1 ring-line">
        <Link
          href={`/budget?month=${previous.slice(0, 7)}`}
          className="grid size-10 place-items-center rounded-full text-ink-2 hover:bg-sunken"
          aria-label={`Previous month, ${formatMonth(previous, { year: true })}`}
        >
          <ChevronLeft className="size-5" aria-hidden />
        </Link>
        <p className="text-sm font-medium">
          {formatMonth(month, { year: true })}
          {month === current ? <span className="ml-2 text-xs font-normal text-ink-3">This month</span> : null}
          {month > current ? <span className="ml-2 text-xs font-normal text-ink-3">Planning</span> : null}
        </p>
        <Link
          href={`/budget?month=${addMonths(month, 1).slice(0, 7)}`}
          className="grid size-10 place-items-center rounded-full text-ink-2 hover:bg-sunken"
          aria-label={`Next month, ${formatMonth(addMonths(month, 1), { year: true })}`}
        >
          <ChevronRight className="size-5" aria-hidden />
        </Link>
      </nav>

      {expense.length === 0 ? (
        <EmptyState
          title="No spending categories yet."
          action={
            <Button asChild>
              <Link href="/budget/categories">Set up categories</Link>
            </Button>
          }
        >
          Categories are the envelopes your budget is split into.
        </EmptyState>
      ) : (
        <BudgetEditor
          key={month}
          month={month}
          previousMonth={previous}
          previousHasBudget={previousBudgets.size > 0}
          categories={expense}
          budgets={budgets}
          spent={spent}
          editable={editable}
        />
      )}
      {!editable && expense.length > 0 ? (
        <p className="mt-2 text-xs text-ink-3">
          Need to correct it?{" "}
          <Link href={`/budget?month=${month.slice(0, 7)}&edit=1`} className="underline underline-offset-4">
            Edit {formatMonth(month)} anyway
          </Link>
        </p>
      ) : null}
    </Page>
  );
}
