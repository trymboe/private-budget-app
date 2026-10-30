import type { Metadata } from "next";
import { Page } from "@/components/page";
import { WelcomeSteps } from "@/components/onboarding/welcome-steps";
import { getCategories, getConnections, getMonthBudgets, getProfile, getToday } from "@/lib/data/queries";
import { monthStart } from "@/lib/dates";
import { APP_NAME } from "@/lib/brand";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Welcome" };

export default async function WelcomePage() {
  const [profile, today] = await Promise.all([getProfile(), getToday()]);
  let categories = await getCategories();
  if (categories.length === 0) {
    // First visit: start from a sensible, fully editable set. (getCategories is
    // cached for this request, so read the fresh rows directly.)
    const supabase = await createClient();
    await supabase.rpc("create_starter_categories");
    const { data } = await supabase.from("categories").select("id, name, kind, icon, color, is_fixed, sort_order, archived_at").order("sort_order");
    categories = (data ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      icon: r.icon,
      color: r.color,
      isFixed: r.is_fixed,
      sortOrder: r.sort_order,
      archived: r.archived_at !== null,
    }));
  }
  const month = monthStart(today);
  const [connections, budgets] = await Promise.all([getConnections(), getMonthBudgets(month)]);
  const supabase = await createClient();
  const { count } = await supabase
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .eq("needs_review", true)
    .is("removed_at", null);

  return (
    <Page className="max-w-xl">
      <p className="font-display text-lg">{APP_NAME}</p>
      <h1 className="mt-10 font-display text-2xl leading-none tracking-tight">Let’s set up your month.</h1>
      <p className="mt-3 text-sm text-ink-2">Three short steps. Skip anything and come back later; the app works from the first minute.</p>
      <WelcomeSteps
        month={month}
        bankConnected={connections.some((c) => c.accounts.length > 0) || profile.onboarding.bank}
        budgetDone={profile.onboarding.budget || budgets.size > 0}
        categories={categories.filter((c) => c.kind === "expense" && !c.archived)}
        budgets={Object.fromEntries(budgets)}
        reviewCount={count ?? 0}
      />
    </Page>
  );
}
