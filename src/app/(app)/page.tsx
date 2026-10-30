import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Settings } from "lucide-react";
import { CategoryMark } from "@/components/category-icon";
import { DataNotes, ConsentReminder } from "@/components/data-notes";
import { Page } from "@/components/page";
import { Money } from "@/components/ui/amount";
import { SectionLabel } from "@/components/ui/field";
import { BudgetBar } from "@/components/ui/progress";
import type { CategoryLine, MonthSummary } from "@/lib/budget";
import { getConnections, getMonthView, getProfile, getToday } from "@/lib/data/queries";
import { formatDay, formatMonth, monthStart } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Home" };

export default async function HomePage() {
  const [profile, today] = await Promise.all([getProfile(), getToday()]);
  const view = await getMonthView(monthStart(today));
  if (!profile.onboarding.completed && view.categories.length === 0) redirect("/welcome");
  const connections = await getConnections();
  const { summary } = view;
  const flexible = summary.lines.filter((l) => !l.category.isFixed);
  const fixed = summary.lines.filter((l) => l.category.isFixed && (l.budget > 0 || l.spent !== 0));

  return (
    <Page>
      <div className="flex items-center justify-between">
        <p className="eyebrow">
          {formatMonth(summary.month)} · {summary.daysLeft === 1 ? "last day" : `${summary.daysLeft} days left`}
        </p>
        <Link href="/settings" aria-label="Settings" className="-mr-2 grid size-10 place-items-center rounded-full text-ink-2 hover:bg-sunken lg:hidden">
          <Settings className="size-5" strokeWidth={1.6} aria-hidden />
        </Link>
      </div>

      <MonthPosition summary={summary} />

      <div className="mt-8 space-y-3">
        {view.reviewCount > 0 ? <ReviewPrompt count={view.reviewCount} /> : null}
        <ConsentReminder connections={connections} today={today} />
        {!view.hasAccounts ? <ConnectPrompt /> : null}
        {!profile.onboarding.completed && view.categories.length > 0 ? <FinishSetup profile={profile.onboarding} /> : null}
        <DataNotes notes={view.notes} uncategorized={summary.uncategorized} foreignCount={summary.foreignCurrencyCount} />
      </div>

      {summary.totalBudget > 0 ? <WeekInsight summary={summary} today={today} /> : null}

      <section className="mt-12" aria-labelledby="categories-heading">
        <div className="flex items-baseline justify-between">
          <SectionLabel id="categories-heading">Categories</SectionLabel>
          <Link href="/budget" className="text-xs text-ink-2 underline-offset-4 hover:text-ink hover:underline">
            Edit budget
          </Link>
        </div>
        {summary.lines.length === 0 ? (
          <p className="mt-4 text-sm text-ink-2">
            No categories yet. <Link href="/budget/categories" className="underline underline-offset-4">Create some</Link> to start budgeting.
          </p>
        ) : (
          <>
            <CategoryList lines={flexible} month={summary.month} />
            {fixed.length > 0 ? (
              <>
                <div className="mt-8 flex items-baseline justify-between">
                  <SectionLabel>Fixed costs</SectionLabel>
                  <p className="tnum text-xs text-ink-3">
                    {formatMoney(summary.pace.fixedSpent, "NOK", { decimals: "never" })} of{" "}
                    {formatMoney(summary.pace.fixedBudget, "NOK", { decimals: "never" })} paid
                  </p>
                </div>
                <CategoryList lines={fixed} month={summary.month} />
              </>
            ) : null}
          </>
        )}
      </section>

      {summary.income !== 0 ? (
        <p className="mt-10 flex items-baseline justify-between border-t border-line pt-4 text-sm text-ink-2">
          <span>Income this month</span>
          <Money minor={summary.income} className="text-accent" />
        </p>
      ) : null}
    </Page>
  );
}

function MonthPosition({ summary }: { summary: MonthSummary }) {
  if (summary.totalBudget === 0) {
    return (
      <section className="mt-6" aria-label="This month">
        <p className="font-display text-3xl leading-none tracking-tight">
          <Money minor={summary.spent} />
        </p>
        <p className="mt-3 text-sm text-ink-2">spent so far this month.</p>
        <Link
          href="/budget"
          className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-ink underline-offset-4 hover:underline"
        >
          Set a monthly budget <ArrowRight className="size-4" aria-hidden />
        </Link>
      </section>
    );
  }
  const over = summary.remaining < 0;
  const marker =
    summary.isCurrentMonth && summary.totalBudget > 0 ? Math.round((summary.pace.expectedTotalByNow * 100) / summary.totalBudget) : null;
  return (
    <section className="mt-6" aria-label="This month">
      <h1 className="font-display text-3xl leading-[0.9] tracking-tight sm:text-[5rem]">
        <Money minor={Math.abs(summary.remaining)} />
      </h1>
      <p className="mt-3 text-sm text-ink-2">
        {over ? (
          <span className="text-brick">over your {formatMoney(summary.totalBudget, "NOK", { decimals: "never" })} budget</span>
        ) : (
          <>left of your {formatMoney(summary.totalBudget, "NOK", { decimals: "never" })} budget</>
        )}
      </p>
      <BudgetBar
        className="mt-6"
        size="md"
        percent={summary.usedPercent}
        status={over ? "over" : summary.usedPercent >= 100 ? "approaching" : "neutral"}
        marker={marker}
        label={`${summary.usedPercent}% of this month's budget used`}
      />
      <div className="tnum mt-3 flex justify-between text-xs text-ink-3">
        <span>{formatMoney(summary.spent, "NOK", { decimals: "never" })} spent</span>
        {marker !== null ? (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-3 w-px bg-ink" />
            steady pace for today
          </span>
        ) : null}
      </div>
    </section>
  );
}

function WeekInsight({ summary, today }: { summary: MonthSummary; today: string }) {
  const { pace } = summary;
  if (!summary.isCurrentMonth || pace.flexibleBudget === 0) return null;
  const ahead = pace.flexibleAhead;
  const weekPercent = pace.weekAllowance > 0 ? Math.round((pace.weekSpent * 100) / pace.weekAllowance) : 0;
  const fmt = (m: number) => formatMoney(m, "NOK", { decimals: "never" });
  const paceSentence =
    Math.abs(ahead) * 100 < pace.flexibleBudget * 3
      ? "Day-to-day spending is right on a steady pace."
      : ahead > 0
        ? `Day-to-day spending is ${fmt(ahead)} below a steady pace.`
        : `Day-to-day spending is ${fmt(-ahead)} ahead of a steady pace.`;

  return (
    <section className="mt-12" aria-labelledby="week-heading">
      <SectionLabel id="week-heading">This week</SectionLabel>
      <div className="mt-4 flex items-baseline justify-between gap-4">
        <p className="font-display text-xl leading-none">
          <Money minor={pace.weekSpent} />
        </p>
        <p className="tnum text-right text-xs text-ink-2">of about {fmt(pace.weekAllowance)} for the week</p>
      </div>
      <BudgetBar
        className="mt-3"
        percent={weekPercent}
        status={weekPercent > 100 ? "over" : weekPercent >= 85 ? "approaching" : "comfortable"}
        label={`${weekPercent}% of this week's allowance used`}
      />
      <p className="mt-4 text-sm leading-relaxed text-ink-2">
        {paceSentence}{" "}
        {summary.daysLeft > 0 ? (
          <>
            You can spend about <span className="tnum text-ink">{fmt(pace.dailyAllowance)}</span> a day for the rest of {formatMonth(summary.month)}.
          </>
        ) : null}
        <span className="sr-only"> As of {formatDay(today, today)}.</span>
      </p>
    </section>
  );
}

function CategoryList({ lines, month }: { lines: CategoryLine[]; month: string }) {
  return (
    <ul className="mt-2 divide-y divide-line">
      {lines.map((line) => (
        <li key={line.category.id}>
          <Link
            href={`/transactions?category=${line.category.id}&month=${month.slice(0, 7)}`}
            className="group -mx-2 flex items-center gap-3.5 rounded-md px-2 py-3.5 transition-colors hover:bg-sunken/50"
          >
            <CategoryMark icon={line.category.icon} color={line.category.color} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <p className="truncate text-sm font-medium">{line.category.name}</p>
                <p className="tnum shrink-0 text-sm">
                  <Money minor={line.spent} />
                  {line.budget > 0 ? (
                    <span className="text-ink-3"> / {formatMoney(line.budget, "NOK", { decimals: "never" })}</span>
                  ) : null}
                </p>
              </div>
              {line.budget > 0 ? (
                <div className="mt-2 flex items-center gap-3">
                  <BudgetBar percent={line.usedPercent} status={line.status} label={`${line.category.name}: ${line.usedPercent}% used`} />
                  <p
                    className={cn(
                      "tnum w-28 shrink-0 text-right text-2xs",
                      line.status === "over" ? "text-brick" : line.status === "approaching" ? "text-ochre" : "text-ink-3",
                    )}
                  >
                    {line.remaining >= 0
                      ? `${formatMoney(line.remaining, "NOK", { decimals: "never" })} left`
                      : `${formatMoney(-line.remaining, "NOK", { decimals: "never" })} over`}
                  </p>
                </div>
              ) : line.spent !== 0 ? (
                <p className="mt-1 text-2xs text-ink-3">No budget this month</p>
              ) : null}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function ReviewPrompt({ count }: { count: number }) {
  return (
    <Link
      href="/review"
      className="group flex items-center justify-between gap-4 rounded-lg bg-ink px-5 py-4 text-paper transition-transform active:scale-[0.99]"
    >
      <span>
        <span className="block text-sm font-medium">
          {count} {count === 1 ? "transaction" : "transactions"} to review
        </span>
        <span className="mt-0.5 block text-xs text-paper/60">
          {count <= 15 ? "Takes less than a minute" : "Categorise them in one sitting, or a few at a time"}
        </span>
      </span>
      <ArrowRight className="size-5 transition-transform group-hover:translate-x-0.5" aria-hidden />
    </Link>
  );
}

function ConnectPrompt() {
  return (
    <Link
      href="/settings/connect"
      className="flex items-center justify-between gap-4 rounded-lg px-5 py-4 ring-1 ring-inset ring-line-strong transition-colors hover:bg-sunken/50"
    >
      <span>
        <span className="block text-sm font-medium">Connect your bank</span>
        <span className="mt-0.5 block text-xs text-ink-2">Transactions arrive by themselves, every day.</span>
      </span>
      <ArrowRight className="size-5 text-ink-2" aria-hidden />
    </Link>
  );
}

function FinishSetup({ profile }: { profile: { bank: boolean; budget: boolean } }) {
  const remaining = [!profile.bank && "connect a bank", !profile.budget && "set your budget"].filter(Boolean);
  if (remaining.length === 0) return null;
  return (
    <Link href="/welcome" className="flex items-center justify-between gap-4 rounded-lg px-5 py-4 ring-1 ring-inset ring-line hover:bg-sunken/50">
      <span className="text-sm">
        <span className="font-medium">Finish setting up:</span> <span className="text-ink-2">{remaining.join(" and ")}</span>
      </span>
      <ArrowRight className="size-5 text-ink-2" aria-hidden />
    </Link>
  );
}
