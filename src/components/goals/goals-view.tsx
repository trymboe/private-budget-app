import { Info } from "lucide-react";
import { EmptyState, Page, PageHeader } from "@/components/page";
import { Money } from "@/components/ui/amount";
import { SectionLabel } from "@/components/ui/field";
import { BudgetBar } from "@/components/ui/progress";
import type { GoalContribution, SavingsGoal } from "@/lib/data/goals";
import { APP_NAME } from "@/lib/brand";
import { formatDay, formatMonth, type IsoDate } from "@/lib/dates";
import { EditGoalButton, NewGoalButton, type LinkableAccount } from "./goal-form";
import { ContributionList, GoalStatusActions, LogSavingsButton } from "./goal-controls";
import { GoalRow, kr, paceMarker, StatusBadge } from "./goal-summary";

// Pure presentation: all data comes in as props (see app/(app)/goals).

export type SpaceContext = { label: string; shared: boolean; note: string };

export function GoalsView({
  goals,
  accounts,
  today,
  space,
}: {
  goals: SavingsGoal[];
  accounts: LinkableAccount[];
  today: IsoDate;
  space: SpaceContext;
}) {
  const active = goals.filter((g) => g.status === "active");
  const finished = goals.filter((g) => g.status !== "active");
  const saved = active.reduce((sum, g) => sum + Math.max(0, g.progress.savedMinor), 0);
  const target = active.reduce((sum, g) => sum + g.targetMinor, 0);
  const monthly = active.reduce((sum, g) => sum + (g.progress.schedule?.perMonthMinor ?? 0), 0);

  return (
    <Page>
      <PageHeader
        title="Savings goals"
        eyebrow={space.shared ? space.label : undefined}
        back={{ href: "/", label: "Home" }}
        actions={goals.length > 0 ? <NewGoalButton accounts={accounts} today={today} spaceNote={space.note} /> : null}
      />

      {goals.length === 0 ? (
        <EmptyState title="Nothing to save for yet?" action={<NewGoalButton accounts={accounts} today={today} spaceNote={space.note} variant="accent" />}>
          A goal can follow a savings account, or you can log what you put aside. Add a date and {APP_NAME} works out how much a month it takes.
        </EmptyState>
      ) : (
        <>
          {active.length > 0 ? (
            <section aria-label="Saved toward active goals">
              <p className="font-display text-3xl leading-none tracking-tight">
                <Money minor={saved} />
              </p>
              <p className="mt-3 text-sm text-ink-2">
                saved toward {active.length === 1 ? "one goal" : `${active.length} goals`} of {kr(target)}
                {monthly > 0 ? (
                  <>
                    {" "}· about <span className="tnum text-ink">{kr(monthly)}</span> a month keeps every dated goal on time
                  </>
                ) : null}
                .
              </p>
            </section>
          ) : null}

          <section className="mt-10" aria-labelledby="active-goals">
            <SectionLabel id="active-goals">Active</SectionLabel>
            {active.length === 0 ? (
              <p className="mt-3 text-sm text-ink-2">No active goals. Start a new one, or make a finished one active again.</p>
            ) : (
              <ul className="mt-1 divide-y divide-line">
                {active.map((g) => (
                  <li key={g.id}>
                    <GoalRow goal={g} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {finished.length > 0 ? (
            <section className="mt-10" aria-labelledby="finished-goals">
              <SectionLabel id="finished-goals">Completed and archived</SectionLabel>
              <ul className="mt-1 divide-y divide-line">
                {finished.map((g) => (
                  <li key={g.id}>
                    <GoalRow goal={g} compact />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <p className="mt-10 text-xs leading-relaxed text-ink-3">
            {space.note} The tick on each bar marks where a steady pace from the start date would be today.
          </p>
        </>
      )}
    </Page>
  );
}

export function GoalDetailView({
  goal,
  contributions,
  accounts,
  today,
  space,
  names,
}: {
  goal: SavingsGoal;
  contributions: GoalContribution[];
  accounts: LinkableAccount[];
  today: IsoDate;
  space: SpaceContext;
  names: Record<string, string> | null;
}) {
  const { progress } = goal;
  const marker = paceMarker(goal);

  return (
    <Page>
      <PageHeader title={goal.name} eyebrow={space.shared ? `${space.label} goal` : "Savings goal"} back={{ href: "/goals", label: "Goals" }} />

      <section aria-label="Progress">
        <p className="font-display text-3xl leading-none tracking-tight">
          <Money minor={Math.max(0, progress.savedMinor)} />
        </p>
        <p className="mt-3 text-sm text-ink-2">
          saved of <span className="tnum">{kr(goal.targetMinor)}</span>
          {goal.targetDate ? <> by {formatDay(goal.targetDate, today)}</> : null}
        </p>
        <BudgetBar
          className="mt-6"
          size="md"
          percent={progress.percent}
          status={goal.status === "active" ? "comfortable" : "unbudgeted"}
          marker={marker}
          label={`${progress.percent}% of ${goal.name} saved`}
        />
        <div className="tnum mt-3 flex items-baseline justify-between gap-3 text-xs text-ink-3">
          <span>
            {progress.percent} % · {progress.reached ? "target met" : `${kr(progress.leftMinor)} left`}
          </span>
          {marker !== null ? (
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="h-3 w-px bg-ink" />
              steady pace for today
            </span>
          ) : (
            <StatusBadge goal={goal} />
          )}
        </div>
      </section>

      {goal.status === "active" ? (
        <section className="mt-8 rounded-lg bg-surface p-5 ring-1 ring-line" aria-label="Plan">
          <PlanSentence goal={goal} />
          <div className="mt-5">
            <LogSavingsButton goalId={goal.id} goalName={goal.name} today={today} />
          </div>
        </section>
      ) : (
        <p className="mt-8 text-sm text-ink-2">
          {goal.status === "completed" ? "This goal is completed." : "This goal is archived."} Its history is kept below.
        </p>
      )}

      <section className="mt-10" aria-labelledby="sources">
        <SectionLabel id="sources">Where it comes from</SectionLabel>
        <dl className="mt-2 divide-y divide-line text-sm">
          {goal.account ? (
            <div className="flex items-baseline justify-between gap-4 py-3">
              <dt className="min-w-0 text-ink-2">
                <span className="block truncate text-ink">{goal.account.name}</span>
                <span className="text-2xs text-ink-3">
                  {progress.accountSource === "balance" ? "Balance" : `Money in since ${formatDay(goal.startsOn, today)}`}
                </span>
              </dt>
              <dd className="tnum shrink-0">
                <Money minor={progress.fromAccountMinor} />
              </dd>
            </div>
          ) : null}
          <div className="flex items-baseline justify-between gap-4 py-3">
            <dt className="text-ink-2">
              <span className="block text-ink">Logged by hand</span>
              <span className="text-2xs text-ink-3">
                {goal.contributionCount === 1 ? "1 entry" : `${goal.contributionCount} entries`}
              </span>
            </dt>
            <dd className="tnum shrink-0">
              <Money minor={progress.fromContributionsMinor} />
            </dd>
          </div>
        </dl>
        {progress.balanceUnavailable ? (
          <p className="mt-3 flex gap-2 text-xs text-ink-2">
            <Info className="mt-0.5 size-3.5 shrink-0 text-ink-3" aria-hidden />
            The bank has not reported a balance for {goal.account?.name ?? "this account"} yet, so money in since the start date is shown.
          </p>
        ) : null}
        {goal.account && goal.account.currency !== "NOK" ? (
          <p className="mt-3 flex gap-2 text-xs text-ink-2">
            <Info className="mt-0.5 size-3.5 shrink-0 text-ink-3" aria-hidden />
            {goal.account.name} is in {goal.account.currency}; its amounts are added as they are, not converted.
          </p>
        ) : null}
      </section>

      <section className="mt-10" aria-labelledby="history">
        <SectionLabel id="history">Logged</SectionLabel>
        <ContributionList goalId={goal.id} contributions={contributions} names={names} today={today} />
      </section>

      <section className="mt-12 space-y-3 border-t border-line pt-6">
        <EditGoalButton
          goal={{
            id: goal.id,
            name: goal.name,
            targetMinor: goal.targetMinor,
            targetDate: goal.targetDate,
            startsOn: goal.startsOn,
            icon: goal.icon,
            color: goal.color,
            accountId: goal.account?.id ?? null,
            accountBasis: goal.account?.basis ?? "growth",
          }}
          accounts={accounts}
          today={today}
        />
        <GoalStatusActions goalId={goal.id} goalName={goal.name} status={goal.status} reached={progress.reached} />
      </section>
    </Page>
  );
}

function PlanSentence({ goal }: { goal: SavingsGoal }) {
  const { progress } = goal;
  const s = progress.schedule;
  if (progress.reached) {
    return (
      <p className="text-sm leading-relaxed">
        <span className="font-medium text-accent">Target met.</span> Mark it as completed when you have spent it, or keep going.
      </p>
    );
  }
  if (!s) {
    return (
      <p className="text-sm leading-relaxed text-ink-2">
        <span className="tnum text-ink">{kr(progress.leftMinor)}</span> to go. Add a target date to see how much a month it takes.
      </p>
    );
  }
  if (s.status === "overdue") {
    return (
      <p className="text-sm leading-relaxed text-ink-2">
        <span className="font-medium text-ochre">The target date has passed</span> with <span className="tnum text-ink">{kr(progress.leftMinor)}</span>{" "}
        still to go. Pick a new date to get a monthly amount again.
      </p>
    );
  }
  const months = s.monthsLeft === 1 ? "this month" : `a month for ${s.monthsLeft} months`;
  const pace =
    s.status === "on_track"
      ? "You are on track: right about where a steady pace would be."
      : s.status === "ahead"
        ? `You are ${kr(s.gapMinor)} ahead of a steady pace.`
        : `You are ${kr(-s.gapMinor)} behind a steady pace.`;
  return (
    <div className="space-y-2">
      <p className="text-sm leading-relaxed text-ink-2">
        Put aside <span className="tnum font-medium text-ink">{kr(s.perMonthMinor)}</span> {months} to reach it by {formatMonth(s.targetDate, { year: true })}.
      </p>
      <p className={s.status === "behind" ? "text-sm text-ochre" : "text-sm text-accent"}>{pace}</p>
    </div>
  );
}
