import type { Metadata } from "next";
import { GoalsView } from "@/components/goals/goals-view";
import { getGoals, getLinkableAccounts, goalSpaceContext } from "@/lib/data/goals";
import { getToday } from "@/lib/data/queries";
import { getActiveSpace } from "@/lib/spaces";

export const metadata: Metadata = { title: "Savings goals" };

export default async function GoalsPage() {
  const [goals, accounts, today, space] = await Promise.all([getGoals(), getLinkableAccounts(), getToday(), getActiveSpace()]);
  return <GoalsView goals={goals} accounts={accounts} today={today} space={goalSpaceContext(space)} />;
}
