import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GoalDetailView } from "@/components/goals/goals-view";
import { getGoal, getLinkableAccounts, goalSpaceContext } from "@/lib/data/goals";
import { getToday } from "@/lib/data/queries";
import { getActiveSpace } from "@/lib/spaces";

export const metadata: Metadata = { title: "Savings goal" };

export default async function GoalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();
  // Looked up in the space being viewed: after switching space, a goal from the other one is not found.
  const [found, accounts, today, space] = await Promise.all([getGoal(id), getLinkableAccounts(), getToday(), getActiveSpace()]);
  if (!found) notFound();
  const names =
    space.kind === "shared" ? Object.fromEntries(space.members.map((m) => [m.userId, m.isMe ? "You" : (m.name ?? "Partner")])) : null;
  return (
    <GoalDetailView
      goal={found.goal}
      contributions={found.contributions}
      accounts={accounts}
      today={today}
      space={goalSpaceContext(space)}
      names={names}
    />
  );
}
