import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SectionLabel } from "@/components/ui/field";
import { getGoals } from "@/lib/data/goals";
import { GoalRow } from "./goal-summary";

/**
 * Savings goals on Home: up to three active goals, or a quiet way in when there
 * are none. Loads its own data, so Home only has to place it.
 */
export async function HomeGoalsCard() {
  let goals;
  try {
    goals = (await getGoals()).filter((g) => g.status === "active");
  } catch {
    // Goals are secondary on Home: never let them break the month overview.
    return null;
  }
  if (goals.length === 0) {
    return (
      <Link
        href="/goals"
        className="flex items-center justify-between gap-4 rounded-lg px-5 py-4 ring-1 ring-inset ring-line transition-colors hover:bg-sunken/50"
      >
        <span>
          <span className="block text-sm font-medium">Saving for something?</span>
          <span className="mt-0.5 block text-xs text-ink-2">Set a goal and see what it takes each month.</span>
        </span>
        <ArrowRight className="size-5 text-ink-2" aria-hidden />
      </Link>
    );
  }
  return (
    <section aria-labelledby="goals-heading">
      <div className="flex items-baseline justify-between">
        <SectionLabel id="goals-heading">Savings goals</SectionLabel>
        <Link href="/goals" className="text-xs text-ink-2 underline-offset-4 hover:text-ink hover:underline">
          {goals.length > 3 ? `All ${goals.length}` : "All goals"}
        </Link>
      </div>
      <ul className="mt-1 divide-y divide-line">
        {goals.slice(0, 3).map((g) => (
          <li key={g.id}>
            <GoalRow goal={g} compact />
          </li>
        ))}
      </ul>
    </section>
  );
}
