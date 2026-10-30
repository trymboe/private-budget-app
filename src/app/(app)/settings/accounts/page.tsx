import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { ConnectionCard } from "@/components/bank/connection-card";
import { EmptyState, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { getConnections, getToday } from "@/lib/data/queries";

export const metadata: Metadata = { title: "Accounts" };

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ reconnected?: string }> }) {
  const { reconnected } = await searchParams;
  const [connections, today] = await Promise.all([getConnections(), getToday()]);
  return (
    <Page>
      <PageHeader
        title="Banks & accounts"
        back={{ href: "/settings", label: "Settings" }}
        actions={
          <Button asChild variant="secondary" size="sm">
            <Link href="/settings/connect">
              <Plus className="size-4" aria-hidden /> Add bank
            </Link>
          </Button>
        }
      />
      {reconnected ? (
        <p role="status" className="mb-6 rounded-md bg-accent-soft px-4 py-3 text-sm">
          Access renewed. New transactions will sync tonight, or tap Sync now.
        </p>
      ) : null}
      {connections.length === 0 ? (
        <EmptyState
          title="No banks connected."
          action={
            <Button asChild>
              <Link href="/settings/connect">Connect your bank</Link>
            </Button>
          }
        >
          Connect once and new transactions arrive every morning.
        </EmptyState>
      ) : (
        <div className="space-y-10">
          {connections.map((c) => (
            <ConnectionCard key={c.id} connection={c} today={today} />
          ))}
        </div>
      )}
      <p className="mt-12 text-xs leading-relaxed text-ink-3">
        Transactions sync automatically once a day. Banks limit how often apps may fetch data in the background, so “Sync now” is available
        at most once an hour. Your bank access must be renewed with BankID at least every 180 days; nothing you have imported is lost if
        it lapses.
      </p>
    </Page>
  );
}
