"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import type { Category } from "@/lib/data/types";
import { formatMonth } from "@/lib/dates";
import { cn } from "@/lib/utils";

const VIEWS = [
  ["all", "All"],
  ["review", "To review"],
  ["outgoing", "Money out"],
  ["incoming", "Money in"],
  ["transfers", "Transfers"],
  ["excluded", "Excluded"],
] as const;

/** Search box + view chips + a sheet for account, category and month filters. State lives in the URL. */
export function TransactionFilters({
  categories,
  accounts,
  months,
}: {
  categories: Category[];
  accounts: { id: string; name: string }[];
  months: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [sheet, setSheet] = useState(false);
  const [pending, startTransition] = useTransition();
  const view = params.get("view") ?? "all";

  function set(updates: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    startTransition(() => router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false }));
  }

  // Debounced search.
  useEffect(() => {
    if ((params.get("q") ?? "") === q) return;
    const t = setTimeout(() => set({ q: q.trim() || null }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const account = accounts.find((a) => a.id === params.get("account"));
  const category = categories.find((c) => c.id === params.get("category"));
  const month = params.get("month");
  const active = [
    account && { key: "account", label: account.name },
    category && { key: "category", label: category.name },
    month && { key: "month", label: formatMonth(`${month}-01`, { year: true }) },
  ].filter(Boolean) as { key: string; label: string }[];

  return (
    <div className={cn("space-y-3 transition-opacity", pending && "opacity-70")}>
      <div className="flex gap-2">
        <label className="relative flex-1">
          <span className="sr-only">Search transactions</span>
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search merchant, text or note"
            className="h-11 w-full rounded-md bg-surface pr-3 pl-10 text-sm ring-1 ring-inset ring-line placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </label>
        <Button variant="secondary" size="icon" className="size-11 rounded-md" onClick={() => setSheet(true)} aria-label="Filters">
          <SlidersHorizontal className="size-4" aria-hidden />
        </Button>
      </div>

      <div className="-mx-5 flex gap-1.5 overflow-x-auto px-5 pb-1 [scrollbar-width:none] sm:-mx-8 sm:px-8">
        {VIEWS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => set({ view: value === "all" ? null : value })}
            aria-pressed={view === value}
            className={cn(
              "h-8 shrink-0 rounded-full px-3.5 text-xs font-medium transition-colors",
              view === value ? "bg-ink text-paper" : "bg-surface text-ink-2 ring-1 ring-inset ring-line hover:text-ink",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {active.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {active.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => set({ [f.key]: null })}
              className="inline-flex h-7 items-center gap-1 rounded-full bg-accent-soft pr-2 pl-3 text-xs text-ink"
            >
              {f.label}
              <X className="size-3.5" aria-label={`Remove ${f.label} filter`} />
            </button>
          ))}
        </div>
      ) : null}

      <Sheet open={sheet} onOpenChange={setSheet} title="Filter transactions">
        <div className="space-y-5 pt-2">
          <FilterSelect label="Account" value={params.get("account") ?? ""} onChange={(v) => set({ account: v || null })}>
            <option value="">All accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect label="Category" value={params.get("category") ?? ""} onChange={(v) => set({ category: v || null })}>
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.archived ? " (archived)" : ""}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect label="Month" value={month ?? ""} onChange={(v) => set({ month: v || null })}>
            <option value="">Any time</option>
            {months.map((m) => (
              <option key={m} value={m}>
                {formatMonth(`${m}-01`, { year: true })}
              </option>
            ))}
          </FilterSelect>
          <Button block size="lg" onClick={() => setSheet(false)}>
            Show results
          </Button>
        </div>
      </Sheet>
    </div>
  );
}

function FilterSelect({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  const id = `filter-${label.toLowerCase()}`;
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-12 w-full rounded-md bg-surface px-3 text-base ring-1 ring-inset ring-line-strong focus:outline-none focus:ring-2 focus:ring-accent"
      >
        {children}
      </select>
    </div>
  );
}
