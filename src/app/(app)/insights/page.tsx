import type { Metadata } from "next";
import { InsightsView } from "@/components/insights/insights-view";
import { getInsights } from "@/lib/data/insights";

export const metadata: Metadata = { title: "Insights" };

export default async function InsightsPage() {
  return <InsightsView data={await getInsights()} />;
}
