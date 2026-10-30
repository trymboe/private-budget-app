"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { loadMoreTransactions } from "@/app/actions/transactions";
import { Button } from "@/components/ui/button";
import type { TransactionFilters } from "@/lib/data/queries";
import type { Category, TransactionListItem } from "@/lib/data/types";
import { formatDay, type IsoDate } from "@/lib/dates";
import { TransactionRow } from "./transaction-row";
import { TransactionSheet } from "./transaction-sheet";

type Cursor = { date: IsoDate; id: string } | null;

/** Date-grouped list with incremental loading (keyset cursor) and a details sheet. */
export function TransactionList({
  initial,
  initialCursor,
  filters,
  categories,
  today,
}: {
  initial: TransactionListItem[];
  initialCursor: Cursor;
  filters: TransactionFilters;
  categories: Category[];
  today: IsoDate;
}) {
  const [items, setItems] = useState(initial);
  const [cursor, setCursor] = useState<Cursor>(initialCursor);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [loading, startLoading] = useTransition();
  const sentinel = useRef<HTMLDivElement>(null);
  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  // New server data (after a save elsewhere): start over from it.
  const [source, setSource] = useState(initial);
  if (source !== initial) {
    setSource(initial);
    setItems(initial);
    setCursor(initialCursor);
  }

  const loadMore = useCallback(() => {
    if (!cursor || loading) return;
    startLoading(async () => {
      try {
        const page = await loadMoreTransactions(filters, cursor);
        setItems((prev) => {
          const seen = new Set(prev.map((t) => t.id));
          return [...prev, ...page.items.filter((t) => !seen.has(t.id))];
        });
        setCursor(page.nextCursor);
        setError(false);
      } catch {
        setError(true);
      }
    });
  }, [cursor, filters, loading]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !cursor) return;
    const observer = new IntersectionObserver((entries) => entries[0]?.isIntersecting && loadMore(), { rootMargin: "600px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [cursor, loadMore]);

  const groups = useMemo(() => {
    const out: { date: IsoDate; items: TransactionListItem[] }[] = [];
    for (const tx of items) {
      const last = out.at(-1);
      if (last && last.date === tx.effectiveDate) last.items.push(tx);
      else out.push({ date: tx.effectiveDate, items: [tx] });
    }
    return out;
  }, [items]);

  const open = items.find((t) => t.id === openId) ?? null;

  return (
    <>
      <div className="space-y-6">
        {groups.map((g) => (
          <section key={g.date} aria-label={formatDay(g.date, today)}>
            <h2 className="eyebrow sticky top-0 z-10 -mx-5 bg-paper/95 px-5 py-2 backdrop-blur-sm sm:-mx-8 sm:px-8">
              {formatDay(g.date, today)}
            </h2>
            <ul>
              {g.items.map((tx) => (
                <li key={tx.id}>
                  <TransactionRow tx={tx} categories={byId} onOpen={(t) => setOpenId(t.id)} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <div ref={sentinel} className="py-8 text-center">
        {cursor ? (
          <Button variant="ghost" size="sm" onClick={loadMore} disabled={loading}>
            {loading ? "Loading…" : error ? "Could not load. Try again" : "Load more"}
          </Button>
        ) : items.length > 20 ? (
          <p className="text-xs text-ink-3">That is everything.</p>
        ) : null}
      </div>

      <TransactionSheet
        tx={open}
        categories={categories}
        today={today}
        onClose={() => setOpenId(null)}
        onChanged={(updated) => setItems((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))}
      />
    </>
  );
}
