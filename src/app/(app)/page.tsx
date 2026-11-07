import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { HomeView } from "@/components/home/home-view";
import { summarizeBalances } from "@/lib/balances";
import { getRecentAutoFiled } from "@/lib/data/auto";
import { getConnections, getMonthView, getProfile, getToday } from "@/lib/data/queries";
import { monthStart } from "@/lib/dates";

export const metadata: Metadata = { title: "Home" };

/** The moment this request is served, for "updated X ago". */
function requestTime() {
  return new Date();
}

export default async function HomePage() {
  const [profile, today] = await Promise.all([getProfile(), getToday()]);
  const view = await getMonthView(monthStart(today));
  if (!profile.onboarding.completed && view.categories.length === 0) redirect("/welcome");
  // Accounts in the space being viewed (RLS keeps a partner's private ones out).
  const [connections, autoFiled] = await Promise.all([getConnections(), getRecentAutoFiled()]);
  const now = requestTime();
  return (
    <HomeView
      summary={view.summary}
      today={today}
      now={now.toISOString()}
      reviewCount={view.reviewCount}
      hasAccounts={view.hasAccounts}
      hasCategories={view.categories.length > 0}
      onboarding={profile.onboarding}
      notes={view.notes}
      connections={connections}
      balances={summarizeBalances(connections, now)}
      autoFiled={autoFiled}
    />
  );
}
