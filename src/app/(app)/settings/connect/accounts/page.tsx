import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccountImport } from "@/components/bank/account-import";
import { Page, PageHeader } from "@/components/page";
import { getConnections, getProfile } from "@/lib/data/queries";

export const metadata: Metadata = { title: "Choose accounts" };

export default async function ChooseAccountsPage({ searchParams }: { searchParams: Promise<{ connection?: string }> }) {
  const { connection: id } = await searchParams;
  const [connections, profile] = await Promise.all([getConnections(), getProfile()]);
  const connection = connections.find((c) => c.id === id);
  if (!connection) notFound();

  return (
    <Page>
      <PageHeader title="Choose accounts" eyebrow={connection.institutionName} />
      <p className="-mt-4 mb-8 text-sm text-ink-2">
        Connected. Pick the accounts to follow. Accounts you leave out are not imported, and you can change this later.
      </p>
      <AccountImport
        connectionId={connection.id}
        accounts={connection.accounts}
        requestedFrom={connection.accounts[0]?.historyRequestedFrom ?? null}
        nextHref={profile.onboarding.budget ? "/review" : "/welcome"}
      />
    </Page>
  );
}
