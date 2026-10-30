import type { Metadata } from "next";
import { CategoryManager } from "@/components/budget/category-manager";
import { Page, PageHeader } from "@/components/page";
import { getCategories } from "@/lib/data/queries";

export const metadata: Metadata = { title: "Categories" };

export default async function CategoriesPage() {
  const categories = await getCategories();
  return (
    <Page>
      <PageHeader title="Categories" back={{ href: "/budget", label: "Budget" }} />
      <CategoryManager categories={categories} />
    </Page>
  );
}
