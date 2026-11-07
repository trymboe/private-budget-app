import type { Metadata } from "next";
import { AutoMerchants } from "@/components/auto/auto-merchants";
import { Page, PageHeader } from "@/components/page";
import { getAutoSettings } from "@/lib/data/auto";
import { getCategories } from "@/lib/data/queries";

export const metadata: Metadata = { title: "Auto-categorised merchants" };

export default async function AutoCategorisePage() {
  const [settings, categories] = await Promise.all([getAutoSettings(), getCategories()]);
  return (
    <Page>
      <PageHeader title="Auto-categorised merchants" back={{ href: "/settings", label: "Settings" }} />
      <AutoMerchants settings={settings} categories={categories} />
    </Page>
  );
}
