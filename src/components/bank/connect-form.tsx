"use client";

import { useActionState, useMemo, useState } from "react";
import { Check, Search } from "lucide-react";
import { startBankConnection, type StartState } from "@/app/actions/bank";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label, SectionLabel } from "@/components/ui/field";
import { addDays, addMonths, formatShortDate, type IsoDate } from "@/lib/dates";
import { cn } from "@/lib/utils";

export type InstitutionOption = { provider: "enable_banking" | "demo"; name: string; country: string; beta: boolean; demo: boolean };

const RANGES = [
  { months: 3, label: "3 months" },
  { months: 6, label: "6 months" },
  { months: 12, label: "1 year" },
  { months: 24, label: "2 years" },
] as const;

/**
 * Pick a bank and how far back to import, then hand over to the bank's own
 * consent flow. The bank decides how much history it will actually share, and
 * the copy says so up front.
 */
export function ConnectForm({
  institutions,
  today,
  reconnect,
}: {
  institutions: InstitutionOption[];
  today: IsoDate;
  reconnect?: { id: string; institution: InstitutionOption };
}) {
  const [state, action, pending] = useActionState<StartState, FormData>(startBankConnection, undefined);
  const [selected, setSelected] = useState<InstitutionOption | null>(reconnect?.institution ?? institutions[0] ?? null);
  const [query, setQuery] = useState("");
  const [range, setRange] = useState<number | "custom">(12);
  const [custom, setCustom] = useState<IsoDate>(addMonths(today, -12));

  const historyFrom = range === "custom" ? custom : addDays(addMonths(today, -range), 1);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? institutions.filter((i) => i.name.toLowerCase().includes(q)) : institutions;
  }, [institutions, query]);

  return (
    <form action={action} className="space-y-10">
      <input type="hidden" name="provider" value={selected?.provider ?? ""} />
      <input type="hidden" name="institution" value={selected?.name ?? ""} />
      <input type="hidden" name="country" value={selected?.country ?? ""} />
      <input type="hidden" name="historyFrom" value={reconnect ? addDays(today, -90) : historyFrom} />
      {reconnect ? <input type="hidden" name="reconnect" value={reconnect.id} /> : null}

      {!reconnect ? (
        <section>
          <SectionLabel>Your bank</SectionLabel>
          {institutions.length > 8 ? (
            <label className="relative mt-3 block">
              <span className="sr-only">Search banks</span>
              <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search Norwegian banks"
                className="h-11 w-full rounded-md bg-surface pr-3 pl-10 text-sm ring-1 ring-inset ring-line focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </label>
          ) : null}
          <ul className="mt-3 max-h-80 divide-y divide-line overflow-y-auto rounded-lg ring-1 ring-line" role="radiogroup" aria-label="Bank">
            {filtered.map((i) => {
              const active = selected?.name === i.name && selected.provider === i.provider;
              return (
                <li key={`${i.provider}:${i.name}`}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setSelected(i)}
                    className={cn("flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left text-sm", active ? "bg-sunken" : "hover:bg-sunken/50")}
                  >
                    <span>
                      {i.name}
                      {i.demo ? <span className="ml-2 text-2xs text-ochre">Development only</span> : null}
                      {i.beta ? <span className="ml-2 text-2xs text-ink-3">Beta</span> : null}
                    </span>
                    {active ? <Check className="size-4" aria-hidden /> : null}
                  </button>
                </li>
              );
            })}
            {filtered.length === 0 ? <li className="px-4 py-6 text-center text-sm text-ink-2">No bank matches “{query}”.</li> : null}
          </ul>
        </section>
      ) : null}

      {!reconnect ? (
        <section>
          <SectionLabel>Import transactions from</SectionLabel>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5" role="radiogroup" aria-label="History">
            {RANGES.map((r) => (
              <button
                key={r.months}
                type="button"
                role="radio"
                aria-checked={range === r.months}
                onClick={() => setRange(r.months)}
                className={cn(
                  "h-11 rounded-md text-sm ring-1 ring-inset transition",
                  range === r.months ? "bg-ink text-paper ring-ink" : "bg-surface ring-line hover:ring-line-strong",
                )}
              >
                {r.label}
              </button>
            ))}
            <button
              type="button"
              role="radio"
              aria-checked={range === "custom"}
              onClick={() => setRange("custom")}
              className={cn(
                "col-span-2 h-11 rounded-md text-sm ring-1 ring-inset transition sm:col-span-1",
                range === "custom" ? "bg-ink text-paper ring-ink" : "bg-surface ring-line hover:ring-line-strong",
              )}
            >
              Pick a date
            </button>
          </div>
          {range === "custom" ? (
            <div className="mt-3 space-y-2">
              <Label htmlFor="custom-date">Start date</Label>
              <Input
                id="custom-date"
                type="date"
                value={custom}
                max={today}
                min={addDays(today, -5 * 365)}
                onChange={(e) => e.target.value && setCustom(e.target.value)}
              />
            </div>
          ) : null}
          <p className="mt-4 text-xs leading-relaxed text-ink-2">
            We will ask for everything from <span className="tnum font-medium text-ink">{formatShortDate(historyFrom)} {historyFrom.slice(0, 4)}</span>.
            Banks decide how much history they share. Many give a year or more, some only 90 days. If yours returns less, we will tell you
            exactly which months are incomplete rather than show them as quiet months.
          </p>
        </section>
      ) : null}

      <section className="space-y-3 rounded-lg bg-sunken/60 p-5 text-xs leading-relaxed text-ink-2">
        <p className="font-medium text-ink">What happens next</p>
        <ol className="list-decimal space-y-1.5 pl-4">
          <li>You are sent to {selected?.name ?? "your bank"} to approve read-only access, usually with BankID.</li>
          <li>Your bank login happens only at your bank. We never see your password or BankID.</li>
          <li>Access lasts up to 180 days (your bank may allow less). We remind you before it ends; renewing takes a minute.</li>
        </ol>
      </section>

      <FieldError>{state?.error}</FieldError>
      <Button type="submit" size="lg" block disabled={pending || !selected}>
        {pending ? "Opening your bank…" : reconnect ? `Renew access at ${reconnect.institution.name}` : `Continue to ${selected?.name ?? "bank"}`}
      </Button>
    </form>
  );
}
