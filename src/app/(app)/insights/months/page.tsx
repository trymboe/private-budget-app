import type { Metadata } from "next";
import { MonthOverMonthView } from "@/components/insights/month-over-month-view";
import { getMonthOverMonth } from "@/lib/data/month-over-month";
import { parseRange } from "@/lib/month-over-month";

export const metadata: Metadata = { title: "Month over month" };

export default async function MonthOverMonthPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const { range } = await searchParams;
  return <MonthOverMonthView data={await getMonthOverMonth(parseRange(range))} />;
}
