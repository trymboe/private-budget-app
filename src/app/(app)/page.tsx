import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { HomeView } from "@/components/home/home-view";
import { getConnections, getMonthView, getProfile, getToday } from "@/lib/data/queries";
import { monthStart } from "@/lib/dates";

export const metadata: Metadata = { title: "Home" };

export default async function HomePage() {
  const [profile, today] = await Promise.all([getProfile(), getToday()]);
  const view = await getMonthView(monthStart(today));
  if (!profile.onboarding.completed && view.categories.length === 0) redirect("/welcome");
  const connections = await getConnections();
  return (
    <HomeView
      summary={view.summary}
      today={today}
      reviewCount={view.reviewCount}
      hasAccounts={view.hasAccounts}
      hasCategories={view.categories.length > 0}
      onboarding={profile.onboarding}
      notes={view.notes}
      connections={connections}
    />
  );
}
