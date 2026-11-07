import Link from "next/link";
import { ArrowRight, Check, Settings } from "lucide-react";
import { CategoryMark } from "@/components/category-icon";
import { DataNotes, ConsentReminder } from "@/components/data-notes";
import { HomeGoalsCard } from "@/components/goals/home-goals-card";
import { Page } from "@/components/page";
import { Money } from "@/components/ui/amount";
import { BudgetBar } from "@/components/ui/progress";
import type { BalanceOverview } from "@/lib/balances";
import type { CategoryLine, MonthSummary } from "@/lib/budget";
import type { DataNote } from "@/lib/data/queries";
import type { ConnectionSummary } from "@/lib/data/types";
import { formatDay, formatMonth } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { BalancesCard } from "./balances-card";
import { HomeCard, HomeSection, SectionLink } from "./section";

export type HomeViewProps = {
  summary: MonthSummary;
  today: string;
  /** Request time (ISO), for "updated X ago". */
  now: string;
  reviewCount: number;
  hasAccounts: boolean;
  hasCategories: boolean;
  onboarding: { bank: boolean; budget: boolean; completed: boolean };
  notes: DataNote[];
  connections: ConnectionSummary[];
  /** Money in accounts for the space being viewed; null when it has no bank accounts. */
  balances: BalanceOverview | null;
};

const kr = (minor: number) => formatMoney(minor, "NOK", { decimals: "never" });

/**
 * The month at a glance. Pure presentation: all data comes in as props.
 *
 * Layout, top to bottom on a phone (desktop puts the side column on the right):
 *   1. Position   how the month stands, left per day, this week
 *   2. Attention  things that want a tap: review, renew, connect, setup, caveats
 *   3. Side       money in accounts, then categories near or over budget
 *   4. Categories every category, then fixed costs and income
 * New cards go in as one <HomeSection> in the block they belong to.
 */
export function HomeView(props: HomeViewProps) {
  const { summary, today, reviewCount, hasAccounts, hasCategories, onboarding, notes, connections, balances } = props;
  const now = new Date(props.now);
  const flexible = summary.lines.filter((l) => !l.category.isFixed);
  const fixed = summary.lines.filter((l) => l.category.isFixed && (l.budget > 0 || l.spent !== 0));
  // A fixed cost paid in full is expected, so only flag fixed costs that went over.
  const watch = summary.lines.filter((l) => l.status === "over" || (l.status === "approaching" && !l.category.isFixed));

  const attention = [
    reviewCount > 0 ? <ReviewPrompt key="review" count={reviewCount} /> : null,
    <ConsentReminder key="consent" connections={connections} today={today} />,
    !hasAccounts ? <ConnectPrompt key="connect" /> : null,
    !onboarding.completed && hasCategories ? <FinishSetup key="setup" profile={onboarding} /> : null,
  ];

  return (
    <Page wide className="max-w-2xl lg:max-w-5xl">
      <header className="flex items-center justify-between">
        <p className="eyebrow">
          {formatMonth(summary.month)} · {summary.daysLeft === 1 ? "last day" : `${summary.daysLeft} days left`}
        </p>
        <Link href="/settings" aria-label="Settings" className="-mr-2 grid size-11 place-items-center rounded-full text-ink-2 hover:bg-sunken lg:hidden">
          <Settings className="size-5" strokeWidth={1.6} aria-hidden />
        </Link>
      </header>

      <div className="flex flex-col gap-10 lg:grid lg:grid-cols-[minmax(0,1fr)_21rem] lg:grid-rows-[auto_auto_1fr] lg:gap-x-14 lg:gap-y-10">
        {/* 1. Position ------------------------------------------------------- */}
        <div className="lg:col-start-1">
          <MonthPosition summary={summary} />
          {summary.totalBudget > 0 ? <PaceStats summary={summary} today={today} /> : null}
        </div>

        {/* 2. Attention ------------------------------------------------------ */}
        <div className="space-y-3 empty:hidden lg:col-start-1">
          {attention}
          <DataNotes notes={notes} uncategorized={summary.uncategorized} foreignCount={summary.foreignCurrencyCount} />
        </div>

        {/* 3. Side column: balances, then what to keep an eye on ------------ */}
        <div className="flex flex-col gap-10 lg:sticky lg:top-12 lg:mt-6 lg:col-start-2 lg:row-span-3 lg:row-start-1 lg:self-start">
          {balances ? (
            <HomeSection id="balances" title="Money in accounts" action={<SectionLink href="/settings/accounts">Accounts</SectionLink>}>
              <BalancesCard overview={balances} now={now} />
            </HomeSection>
          ) : null}
          {summary.totalBudget > 0 ? <WatchList lines={watch} month={summary.month} /> : null}
          <HomeGoalsCard />
        </div>

        {/* 4. Categories ----------------------------------------------------- */}
        <div className="lg:col-start-1">
          <HomeSection id="categories" title="Categories" action={<SectionLink href="/budget">Edit budget</SectionLink>}>
            {summary.lines.length === 0 ? (
              <p className="text-sm text-ink-2">
                No categories yet.{" "}
                <Link href="/budget/categories" className="underline underline-offset-4">
                  Create some
                </Link>{" "}
                to start budgeting.
              </p>
            ) : (
              <CategoryList lines={flexible} month={summary.month} />
            )}
          </HomeSection>

          {fixed.length > 0 ? (
            <HomeSection
              id="fixed"
              title="Fixed costs"
              className="mt-10"
              action={
                <span className="tnum">
                  {kr(summary.pace.fixedSpent)} of {kr(summary.pace.fixedBudget)} paid
                </span>
              }
            >
              <CategoryList lines={fixed} month={summary.month} />
            </HomeSection>
          ) : null}

          {summary.income !== 0 ? (
            <p className="mt-10 flex items-baseline justify-between border-t border-line pt-4 text-sm text-ink-2">
              <span>Income this month</span>
              <Money minor={summary.income} className="text-accent" />
            </p>
          ) : null}
        </div>
      </div>
    </Page>
  );
}

// 1. Position -----------------------------------------------------------------

function MonthPosition({ summary }: { summary: MonthSummary }) {
  if (summary.totalBudget === 0) {
    return (
      <section className="mt-6" aria-label="This month">
        <h1 className="font-display text-2xl leading-none tracking-tight sm:text-3xl">
          <Money minor={summary.spent} />
        </h1>
        <p className="mt-3 text-sm text-ink-2">spent so far this month.</p>
        <Link href="/budget" className="mt-6 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-ink underline-offset-4 hover:underline">
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
      <h1 className="font-display text-[3.5rem] leading-[0.9] tracking-tight sm:text-[5rem]">
        <Money minor={Math.abs(summary.remaining)} />
      </h1>
      <p className="mt-3 text-sm text-ink-2">
        {over ? <span className="text-over">over your {kr(summary.totalBudget)} budget</span> : <>left of your {kr(summary.totalBudget)} budget</>}
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
        <span>{kr(summary.spent)} spent</span>
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

/** Left per day and this week, side by side, with one sentence on pace. */
function PaceStats({ summary, today }: { summary: MonthSummary; today: string }) {
  const { pace } = summary;
  if (!summary.isCurrentMonth || pace.flexibleBudget === 0) return null;
  const ahead = pace.flexibleAhead;
  const weekPercent = pace.weekAllowance > 0 ? Math.round((pace.weekSpent * 100) / pace.weekAllowance) : 0;
  const paceSentence =
    Math.abs(ahead) * 100 < pace.flexibleBudget * 3
      ? "Day-to-day spending is right on a steady pace."
      : ahead > 0
        ? `Day-to-day spending is ${kr(ahead)} below a steady pace.`
        : `Day-to-day spending is ${kr(-ahead)} above a steady pace.`;

  return (
    <section className="mt-8" aria-labelledby="pace-heading">
      <h2 id="pace-heading" className="sr-only">
        Pace
      </h2>
      <HomeCard className="grid grid-cols-2 divide-x divide-line px-0 py-4">
        <div className="px-5">
          <p className="eyebrow">Left per day</p>
          <p className="mt-2 font-display text-lg leading-none">
            {summary.daysLeft > 0 ? <Money minor={pace.dailyAllowance} /> : <span className="text-ink-3">–</span>}
          </p>
          <p className="mt-1.5 text-2xs text-ink-3">
            {summary.daysLeft > 0 ? `for the rest of ${formatMonth(summary.month)}` : "the month is over"}
          </p>
        </div>
        <div className="px-5">
          <p className="eyebrow">This week</p>
          <p className="mt-2 font-display text-lg leading-none">
            <Money minor={pace.weekSpent} />
          </p>
          <p className="tnum mt-1.5 text-2xs text-ink-3">of about {kr(pace.weekAllowance)}</p>
          <BudgetBar
            className="mt-2.5"
            percent={weekPercent}
            status={weekPercent > 100 ? "over" : weekPercent >= 85 ? "approaching" : "comfortable"}
            label={`${weekPercent}% of this week's allowance used`}
          />
        </div>
      </HomeCard>
      <p className="mt-3 text-xs leading-relaxed text-ink-2">
        {paceSentence}
        <span className="sr-only"> As of {formatDay(today, today)}.</span>
      </p>
    </section>
  );
}

// 3. Side column ----------------------------------------------------------------

/** Categories close to or over budget: over first, each group in category order. */
function WatchList({ lines, month }: { lines: CategoryLine[]; month: string }) {
  const sorted = [...lines.filter((l) => l.status === "over"), ...lines.filter((l) => l.status === "approaching")];
  return (
    <HomeSection id="watch" title="Keep an eye on">
      {sorted.length === 0 ? (
        <p className="flex items-center gap-2.5 text-sm text-ink-2">
          <Check className="size-4 text-accent" aria-hidden />
          Every category is within budget so far.
        </p>
      ) : (
        <HomeCard className="py-1">
          <ul className="divide-y divide-line">
            {sorted.map((line) => (
              <li key={line.category.id}>
                <Link
                  href={`/transactions?category=${line.category.id}&month=${month.slice(0, 7)}`}
                  className="-mx-2 flex min-h-14 items-center gap-3 rounded-md px-2 py-3"
                >
                  <CategoryMark icon={line.category.icon} color={line.category.color} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="truncate text-sm font-medium">{line.category.name}</p>
                      <p className={cn("tnum shrink-0 text-xs", line.status === "over" ? "text-over" : "text-ochre")}>
                        {line.remaining >= 0 ? `${kr(line.remaining)} left` : `${kr(-line.remaining)} over`}
                      </p>
                    </div>
                    <BudgetBar
                      className="mt-2"
                      percent={line.usedPercent}
                      status={line.status}
                      label={`${line.category.name}: ${line.usedPercent}% used`}
                    />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </HomeCard>
      )}
    </HomeSection>
  );
}

// 4. Categories -------------------------------------------------------------------

function CategoryList({ lines, month }: { lines: CategoryLine[]; month: string }) {
  return (
    <ul className="divide-y divide-line">
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
                  {line.budget > 0 ? <span className="text-ink-3"> / {kr(line.budget)}</span> : null}
                </p>
              </div>
              {line.budget > 0 ? (
                <div className="mt-2 flex items-center gap-3">
                  <BudgetBar percent={line.usedPercent} status={line.status} label={`${line.category.name}: ${line.usedPercent}% used`} />
                  <p
                    className={cn(
                      "tnum w-28 shrink-0 text-right text-2xs",
                      line.status === "over" ? "text-over" : line.status === "approaching" ? "text-ochre" : "text-ink-3",
                    )}
                  >
                    {line.remaining >= 0 ? `${kr(line.remaining)} left` : `${kr(-line.remaining)} over`}
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

// 2. Attention ------------------------------------------------------------------

function ReviewPrompt({ count }: { count: number }) {
  return (
    <Link
      href="/review"
      className="group flex items-center justify-between gap-4 rounded-xl bg-ink px-5 py-4 text-paper transition-transform active:scale-[0.99]"
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
      className="flex items-center justify-between gap-4 rounded-xl px-5 py-4 ring-1 ring-inset ring-line-strong transition-colors hover:bg-sunken/50"
    >
      <span>
        <span className="block text-sm font-medium">Connect your bank</span>
        <span className="mt-0.5 block text-xs text-ink-2">Transactions and balances arrive by themselves, every day.</span>
      </span>
      <ArrowRight className="size-5 text-ink-2" aria-hidden />
    </Link>
  );
}

function FinishSetup({ profile }: { profile: { bank: boolean; budget: boolean } }) {
  const remaining = [!profile.bank && "connect a bank", !profile.budget && "set your budget"].filter(Boolean);
  if (remaining.length === 0) return null;
  return (
    <Link href="/welcome" className="flex items-center justify-between gap-4 rounded-xl px-5 py-4 ring-1 ring-inset ring-line hover:bg-sunken/50">
      <span className="text-sm">
        <span className="font-medium">Finish setting up:</span> <span className="text-ink-2">{remaining.join(" and ")}</span>
      </span>
      <ArrowRight className="size-5 text-ink-2" aria-hidden />
    </Link>
  );
}
