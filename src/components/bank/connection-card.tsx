"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { disconnectBank, removeAccount, setAccountOptions, syncNow } from "@/app/actions/bank";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { ConnectionSummary } from "@/lib/data/types";
import { diffDays, formatShortDate, type IsoDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

function relative(ts: string | null, today: IsoDate) {
  if (!ts) return "never";
  const days = diffDays(today, ts.slice(0, 10));
  if (days <= 0) return `today ${new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Oslo" })}`;
  if (days === 1) return "yesterday";
  return `${formatShortDate(ts.slice(0, 10))}`;
}

/** One bank connection: consent status, sync controls and its accounts. */
export function ConnectionCard({ connection, today }: { connection: ConnectionSummary; today: IsoDate }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const c = connection;
  // Disconnected and hand-entered accounts have no bank access to show or manage.
  const isOrphan = c.id === "disconnected" || c.id === "manual";
  const consentDays = c.consentValidUntil ? diffDays(c.consentValidUntil.slice(0, 10), today) : null;

  const statusLine =
    c.status === "active"
      ? consentDays !== null
        ? consentDays <= 14
          ? `Access ends ${consentDays <= 0 ? "today" : `in ${consentDays} ${consentDays === 1 ? "day" : "days"}`}`
          : `Access valid until ${formatShortDate(c.consentValidUntil!.slice(0, 10))}`
        : "Active"
      : c.status === "expired"
        ? "Access expired. Your history is kept; renew to continue syncing."
        : c.status === "revoked"
          ? "Disconnected. Transactions already imported are kept."
          : "Something went wrong with this connection.";

  return (
    <section id={c.id} className="scroll-mt-8 border-t border-line pt-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">
            {c.institutionName}
            {c.provider === "demo" ? <span className="ml-2 align-middle text-2xs font-medium text-ochre">DEMO DATA</span> : null}
          </h2>
          {!isOrphan ? (
            <p className={cn("mt-1 text-xs", c.status === "active" && (consentDays ?? 99) > 14 ? "text-ink-2" : "text-ochre")}>{statusLine}</p>
          ) : null}
          {!isOrphan && c.status === "active" ? (
            <p className="mt-0.5 text-xs text-ink-3">
              Last synced {relative(c.lastSyncedAt, today)}
              {c.rateLimitedUntil && new Date(c.rateLimitedUntil) > new Date() ? " · paused by the bank's rate limit" : ""}
              {c.lastSyncError && c.lastSyncError !== "IMPORT_INCOMPLETE" ? " · last attempt failed" : ""}
            </p>
          ) : null}
        </div>
        {!isOrphan ? (
          <div className="flex shrink-0 gap-1">
            {c.status === "active" ? (
              <Button
                variant="secondary"
                size="sm"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const r = await syncNow(c.id);
                    toast(r.ok ? { message: r.message ?? "Synced" } : { message: r.error, tone: "error" });
                    router.refresh();
                  })
                }
              >
                {pending ? "Syncing…" : "Sync now"}
              </Button>
            ) : null}
            {c.status !== "active" || (consentDays !== null && consentDays <= 30) ? (
              <Button asChild size="sm" variant={c.status === "active" ? "secondary" : "primary"}>
                <Link href={`/settings/connect?reconnect=${c.id}`}>Renew</Link>
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <ul className="mt-4 divide-y divide-line">
        {c.accounts.map((a) => (
          <li key={a.id} className="py-3">
            <div className="flex items-baseline justify-between gap-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{a.name}</p>
                <p className="text-2xs text-ink-3">
                  {a.ibanMasked ?? a.currency}
                  {a.historyAvailableFrom ? ` · history from ${formatShortDate(a.historyAvailableFrom)} ${a.historyAvailableFrom.slice(0, 4)}` : ""}
                  {a.historyLimited ? " (limited by bank)" : ""}
                  {!a.initialImportCompletedAt && a.isSynced ? " · import not finished" : ""}
                </p>
              </div>
              {a.balanceMinor !== null ? (
                <p className="tnum shrink-0 text-sm text-ink-2">{formatMoney(a.balanceMinor, a.currency, { decimals: "never" })}</p>
              ) : null}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
              <Toggle
                label="Count toward budget"
                checked={a.includeInBudget}
                disabled={pending}
                onChange={(v) =>
                  startTransition(async () => {
                    const r = await setAccountOptions(a.id, { includeInBudget: v });
                    if (!r.ok) toast({ message: r.error, tone: "error" });
                    router.refresh();
                  })
                }
              />
              {!isOrphan ? (
                <Toggle
                  label="Keep syncing"
                  checked={a.isSynced}
                  disabled={pending}
                  onChange={(v) =>
                    startTransition(async () => {
                      const r = await setAccountOptions(a.id, { isSynced: v });
                      if (!r.ok) toast({ message: r.error, tone: "error" });
                      router.refresh();
                    })
                  }
                />
              ) : null}
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  if (
                    !confirm(
                      `Remove ${a.name}? All of its transactions and their categories are deleted for good, and your budgets update to match. This cannot be undone.`,
                    )
                  )
                    return;
                  startTransition(async () => {
                    const r = await removeAccount(a.id);
                    toast(
                      r.ok
                        ? { message: `Removed ${a.name} and ${r.removed ?? 0} ${r.removed === 1 ? "transaction" : "transactions"}` }
                        : { message: r.error, tone: "error" },
                    );
                    router.refresh();
                  });
                }}
                className="ml-auto text-xs text-ink-3 underline-offset-4 hover:text-brick hover:underline"
              >
                Remove
              </button>
            </div>
          </li>
        ))}
      </ul>

      {!isOrphan && c.status === "active" ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (!confirm(`Disconnect ${c.institutionName}? Imported transactions are kept, but nothing new will sync.`)) return;
            startTransition(async () => {
              const r = await disconnectBank(c.id);
              toast(r.ok ? { message: "Disconnected" } : { message: r.error, tone: "error" });
              router.refresh();
            });
          }}
          className="mt-2 text-xs text-ink-3 underline-offset-4 hover:text-brick hover:underline"
        >
          Disconnect
        </button>
      ) : null}
    </section>
  );
}

function Toggle({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-2">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="size-4 accent-[var(--ink)]" />
      {label}
    </label>
  );
}
