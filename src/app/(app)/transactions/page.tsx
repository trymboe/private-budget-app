import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { EmptyState, Page, PageHeader } from "@/components/page";
import { AddTransactionButton } from "@/components/transactions/manual-transaction-form";
import { TransactionFilters } from "@/components/transactions/transaction-filters";
import { TransactionList } from "@/components/transactions/transaction-list";
import { Button } from "@/components/ui/button";
import { getCategories, getConnections, getToday, listTransactions, type TransactionFilters as Filters } from "@/lib/data/queries";
import { addMonths, isValidMonthParam, monthEnd, monthStart } from "@/lib/dates";

export const metadata: Metadata = { title: "Transactions" };

const VIEWS = new Set(["all", "review", "incoming", "outgoing", "transfers", "excluded"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const filters: Filters = {
    q: sp.q?.slice(0, 60) || undefined,
    view: sp.view && VIEWS.has(sp.view) ? (sp.view as Filters["view"]) : "all",
    accountId: sp.account && UUID.test(sp.account) ? sp.account : undefined,
    categoryId: sp.category && UUID.test(sp.category) ? sp.category : undefined,
  };
  if (isValidMonthParam(sp.month)) {
    filters.from = `${sp.month}-01`;
    filters.to = monthEnd(`${sp.month}-01`);
  }

  const [page, categories, connections, today] = await Promise.all([
    listTransactions(filters, null),
    getCategories(),
    getConnections(),
    getToday(),
  ]);
  const accounts = connections.flatMap((c) => c.accounts).map((a) => ({ id: a.id, name: a.name }));
  const months = Array.from({ length: 24 }, (_, i) => addMonths(monthStart(today), -i).slice(0, 7));
  const isFiltered = !!(filters.q || filters.accountId || filters.categoryId || filters.from || filters.view !== "all");

  return (
    <Page>
      <PageHeader
        title="Transactions"
        actions={
          <>
            <AddTransactionButton categories={categories} today={today} />
            <Button asChild variant="secondary" size="sm">
              <Link href="/review">
                Review <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            </Button>
          </>
        }
      />
      <TransactionFilters categories={categories} accounts={accounts} months={months} />
      <div className="mt-4">
        {page.items.length === 0 ? (
          isFiltered ? (
            <EmptyState title="Nothing matches.">Try a different search or remove a filter.</EmptyState>
          ) : accounts.length === 0 ? (
            <EmptyState
              title="No transactions yet."
              action={
                <Button asChild>
                  <Link href="/settings/connect">Connect your bank</Link>
                </Button>
              }
            >
              Connect a bank account and your transactions will appear here automatically. You can also add cash and other transactions yourself with Add.
            </EmptyState>
          ) : (
            <EmptyState title="No transactions yet.">The first import may still be running. Check back in a moment.</EmptyState>
          )
        ) : (
          <TransactionList
            key={JSON.stringify(filters)}
            initial={page.items}
            initialCursor={page.nextCursor}
            filters={filters}
            categories={categories}
            today={today}
          />
        )}
      </div>
    </Page>
  );
}
