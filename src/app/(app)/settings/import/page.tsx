import type { Metadata } from "next";
import { BuddyImport } from "@/components/import/buddy-import";
import { Page, PageHeader } from "@/components/page";
import { getCategories } from "@/lib/data/queries";
import { getActiveSpace, spaceLabel } from "@/lib/spaces";

export const metadata: Metadata = { title: "Import from Buddy" };
// The import runs as a server action on this page; years of history can take a while.
export const maxDuration = 300;

export default async function ImportPage() {
  const [categories, space] = await Promise.all([getCategories(), getActiveSpace()]);
  return (
    <Page>
      <PageHeader title="Import from Buddy" back={{ href: "/settings", label: "Settings" }} />
      <BuddyImport
        categories={categories.filter((c) => !c.archived)}
        space={{ id: space.id, label: spaceLabel(space), shared: space.kind === "shared" }}
      />
    </Page>
  );
}
