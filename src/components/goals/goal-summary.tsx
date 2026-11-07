import Link from "next/link";
import { CategoryMark } from "@/components/category-icon";
import { Money } from "@/components/ui/amount";
import { BudgetBar } from "@/components/ui/progress";
import type { SavingsGoal } from "@/lib/data/goals";
import { formatMonth } from "@/lib/dates";
import type { GoalSchedule } from "@/lib/goals";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

// Presentation for savings goals, shared by the Goals page, a goal's own page and
// the Home card. No hooks: safe in server components.

export const kr = (minor: number) => formatMoney(minor, "NOK", { decimals: "never" });

const STATUS_LABEL: Record<GoalSchedule["status"], string> = {
  reached: "Reached",
  ahead: "Ahead",
  on_track: "On track",
  behind: "Behind",
  overdue: "Date passed",
};

export function statusTone(status: GoalSchedule["status"]) {
  return status === "behind" || status === "overdue" ? "text-ochre" : "text-accent";
}

/** Where a steady pace from the start would be today, as a bar marker (0-100). */
export function paceMarker(goal: SavingsGoal): number | null {
  const s = goal.progress.schedule;
  if (!s || goal.status !== "active" || goal.progress.reached || s.status === "overdue") return null;
  return Math.round((s.expectedByNowMinor * 100) / goal.targetMinor);
}

/** "2 500 kr a month until June 2027", or null without a target date. */
export function scheduleLine(goal: SavingsGoal): string | null {
  const s = goal.progress.schedule;
  if (!s) return null;
  if (goal.progress.reached) return null;
  if (s.status === "overdue") return `Target date was ${formatMonth(s.targetDate, { year: true })}`;
  return `${kr(s.perMonthMinor)} a month until ${formatMonth(s.targetDate, { year: true })}`;
}

export function StatusBadge({ goal }: { goal: SavingsGoal }) {
  if (goal.status === "completed") return <span className="text-2xs font-medium text-accent">Completed</span>;
  if (goal.status === "archived") return <span className="text-2xs text-ink-3">Archived</span>;
  if (goal.progress.reached) return <span className="text-2xs font-medium text-accent">Reached</span>;
  const s = goal.progress.schedule;
  if (!s) return null;
  return <span className={cn("text-2xs font-medium", statusTone(s.status))}>{STATUS_LABEL[s.status]}</span>;
}

/** One goal in a list: mark, name, saved of target, bar, and what it takes to get there. */
export function GoalRow({ goal, compact = false }: { goal: SavingsGoal; compact?: boolean }) {
  const { progress } = goal;
  const line = scheduleLine(goal);
  const muted = goal.status !== "active";
  return (
    <Link
      href={`/goals/${goal.id}`}
      className={cn(
        "group -mx-2 flex gap-3.5 rounded-md px-2 transition-colors hover:bg-sunken/50",
        compact ? "items-center py-3" : "items-start py-4",
      )}
    >
      <CategoryMark icon={goal.icon} color={goal.color} size={compact ? "md" : "lg"} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className={cn("truncate text-sm font-medium", muted && "text-ink-2")}>{goal.name}</p>
          <p className="tnum shrink-0 text-sm">
            <Money minor={Math.max(0, progress.savedMinor)} />
            <span className="text-ink-3"> / {kr(goal.targetMinor)}</span>
          </p>
        </div>
        <BudgetBar
          className="mt-2"
          percent={progress.percent}
          status={muted ? "unbudgeted" : "comfortable"}
          marker={paceMarker(goal)}
          label={`${goal.name}: ${progress.percent}% saved`}
        />
        <div className="tnum mt-2 flex items-baseline justify-between gap-3 text-2xs text-ink-3">
          <span className="truncate">
            {progress.reached ? `${progress.percent} % · target met` : `${progress.percent} % · ${kr(progress.leftMinor)} left`}
            {!compact && line ? <span className="block text-ink-2">{line}</span> : null}
          </span>
          <StatusBadge goal={goal} />
        </div>
      </div>
    </Link>
  );
}
