"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, CircleAlert, LoaderCircle } from "lucide-react";
import { saveAccountSelection } from "@/app/actions/bank";
import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/ui/field";
import type { AccountSummary } from "@/lib/data/types";
import { formatShortDate } from "@/lib/dates";
import { cn } from "@/lib/utils";

type Status =
  | { state: "idle" }
  | { state: "running" }
  | { state: "done"; inserted: number; earliest: string | null; limited: boolean }
  | { state: "error"; message: string };

/**
 * After consent: choose which accounts to keep in sync and which count toward the
 * budget, then import their history one account at a time with visible progress.
 */
export function AccountImport({
  connectionId,
  accounts,
  requestedFrom,
  nextHref,
}: {
  connectionId: string;
  accounts: AccountSummary[];
  requestedFrom: string | null;
  nextHref: string;
}) {
  const router = useRouter();
  const [choices, setChoices] = useState(() =>
    Object.fromEntries(accounts.map((a) => [a.id, { isSynced: a.isSynced, includeInBudget: a.includeInBudget }])),
  );
  const [status, setStatus] = useState<Record<string, Status>>({});
  const [phase, setPhase] = useState<"choose" | "importing" | "finished">("choose");
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setError(null);
    const saved = await saveAccountSelection({
      connectionId,
      accounts: accounts.map((a) => ({ id: a.id, ...choices[a.id] })),
    });
    if (!saved.ok) return setError(saved.error);
    setPhase("importing");
    for (const a of accounts) {
      if (!choices[a.id].isSynced || a.initialImportCompletedAt) continue;
      setStatus((s) => ({ ...s, [a.id]: { state: "running" } }));
      try {
        const res = await fetch("/api/bank/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountId: a.id }),
        });
        const body = await res.json();
        setStatus((s) => ({
          ...s,
          [a.id]: body.ok
            ? { state: "done", inserted: body.inserted, earliest: body.earliest, limited: body.limited }
            : { state: "error", message: body.message ?? "Import failed." },
        }));
      } catch {
        setStatus((s) => ({ ...s, [a.id]: { state: "error", message: "Lost connection during the import. You can retry from Settings." } }));
      }
    }
    setPhase("finished");
    router.refresh();
  }

  const selectedCount = accounts.filter((a) => choices[a.id].isSynced).length;

  return (
    <div className="space-y-8">
      <section>
        <SectionLabel>Accounts your bank shared</SectionLabel>
        <ul className="mt-3 divide-y divide-line rounded-lg ring-1 ring-line">
          {accounts.map((a) => {
            const c = choices[a.id];
            const s = status[a.id] ?? { state: "idle" };
            return (
              <li key={a.id} className="px-4 py-4">
                <div className="flex items-start gap-3">
                  <input
                    id={`sync-${a.id}`}
                    type="checkbox"
                    checked={c.isSynced}
                    disabled={phase !== "choose"}
                    onChange={(e) => setChoices((x) => ({ ...x, [a.id]: { ...c, isSynced: e.target.checked } }))}
                    className="mt-0.5 size-5 accent-[var(--ink)]"
                  />
                  <div className="min-w-0 flex-1">
                    <label htmlFor={`sync-${a.id}`} className="block text-sm font-medium">
                      {a.name}
                    </label>
                    <p className="text-2xs text-ink-3">
                      {a.ibanMasked ?? a.currency}
                      {a.provider === "demo" ? " · Demo data, not a real bank" : ""}
                    </p>
                    {c.isSynced && phase === "choose" ? (
                      <label className="mt-2 flex items-center gap-2 text-xs text-ink-2">
                        <input
                          type="checkbox"
                          checked={c.includeInBudget}
                          onChange={(e) => setChoices((x) => ({ ...x, [a.id]: { ...c, includeInBudget: e.target.checked } }))}
                          className="size-4 accent-[var(--ink)]"
                        />
                        Count toward my budget (turn off for savings)
                      </label>
                    ) : null}
                    <ImportStatus status={s} requestedFrom={requestedFrom} />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {error ? (
        <p role="alert" className="text-sm text-brick">
          {error}
        </p>
      ) : null}

      {phase === "choose" ? (
        <Button size="lg" block onClick={start} disabled={selectedCount === 0}>
          Import {selectedCount} {selectedCount === 1 ? "account" : "accounts"}
        </Button>
      ) : phase === "importing" ? (
        <p className="text-center text-sm text-ink-2" aria-live="polite">
          Importing. This usually takes under a minute; keep this page open.
        </p>
      ) : (
        <Button asChild size="lg" block>
          <Link href={nextHref}>Continue</Link>
        </Button>
      )}
    </div>
  );
}

function ImportStatus({ status, requestedFrom }: { status: Status; requestedFrom: string | null }) {
  if (status.state === "idle") return null;
  if (status.state === "running") {
    return (
      <p className="mt-2 flex items-center gap-2 text-xs text-ink-2" aria-live="polite">
        <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> Importing transactions…
      </p>
    );
  }
  if (status.state === "error") {
    return (
      <p className="mt-2 flex items-start gap-2 text-xs text-brick" role="alert">
        <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden /> {status.message}
      </p>
    );
  }
  const partial = status.limited || (status.earliest && requestedFrom && status.earliest > requestedFrom);
  return (
    <div className="mt-2 space-y-1 text-xs" aria-live="polite">
      <p className="flex items-center gap-2 text-accent">
        <Check className="size-3.5" aria-hidden /> {status.inserted} {status.inserted === 1 ? "transaction" : "transactions"} imported
      </p>
      {status.earliest ? (
        <p className={cn("text-ink-2", partial && "text-ochre")}>
          Earliest transaction the bank returned: {formatShortDate(status.earliest)} {status.earliest.slice(0, 4)}.
          {partial ? " Earlier months are marked as incomplete." : ""}
        </p>
      ) : (
        <p className="text-ink-2">The bank returned no transactions for this period.</p>
      )}
    </div>
  );
}
