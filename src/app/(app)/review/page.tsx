import type { Metadata } from "next";
import { Page } from "@/components/page";
import { ReviewFlow } from "@/components/transactions/review-flow";
import { getCategories, getReviewQueue, getToday } from "@/lib/data/queries";

export const metadata: Metadata = { title: "Review" };

export default async function ReviewPage() {
  const [queue, categories, today] = await Promise.all([getReviewQueue(), getCategories(), getToday()]);
  return (
    <Page className="max-w-xl pb-16">
      <ReviewFlow initial={queue} categories={categories} today={today} />
    </Page>
  );
}
