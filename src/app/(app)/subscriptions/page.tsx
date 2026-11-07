import type { Metadata } from "next";
import { SubscriptionsView } from "@/components/subscriptions/subscriptions-view";
import { getSubscriptionsView } from "@/lib/data/subscriptions";

export const metadata: Metadata = { title: "Subscriptions" };

export default async function SubscriptionsPage() {
  return <SubscriptionsView {...await getSubscriptionsView()} />;
}
