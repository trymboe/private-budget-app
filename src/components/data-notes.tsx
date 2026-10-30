import Link from "next/link";
import { Info } from "lucide-react";
import type { DataNote } from "@/lib/data/queries";
import type { ConnectionSummary } from "@/lib/data/types";
import { diffDays, formatShortDate, type IsoDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";

export const CONSENT_REMINDER_DAYS = 14;

/** Quiet, factual caveats. Missing data must never look like low spending. */
export function DataNotes({
  notes,
  uncategorized,
  foreignCount,
}: {
  notes: DataNote[];
  uncategorized?: { count: number; outflow: number };
  foreignCount?: number;
}) {
  const lines: React.ReactNode[] = [];
  for (const n of notes) {
    if (n.kind === "partial_history") {
      lines.push(
        <>
          {n.accountName}: the earliest transaction your bank shared is from {formatShortDate(n.availableFrom)}, so this month may be
          incomplete.
        </>,
      );
    } else if (n.kind === "import_incomplete") {
      lines.push(<>{n.accountName} has not finished its first import yet, so totals may be partial.</>);
    } else if (n.kind === "stale") {
      lines.push(
        <>
          {n.institutionName} has not synced since {n.lastSyncedAt ? formatShortDate(n.lastSyncedAt.slice(0, 10)) : "it was connected"}.{" "}
          <Link href="/settings/accounts" className="underline underline-offset-4">
            Reconnect
          </Link>{" "}
          to bring in newer transactions.
        </>,
      );
    }
  }
  if (uncategorized && uncategorized.count > 0 && uncategorized.outflow > 0) {
    lines.push(
      <>
        {formatMoney(uncategorized.outflow, "NOK", { decimals: "never" })} in {uncategorized.count} uncategorised{" "}
        {uncategorized.count === 1 ? "transaction is" : "transactions are"} not in these totals yet.
      </>,
    );
  }
  if (foreignCount && foreignCount > 0) {
    lines.push(
      <>
        {foreignCount} {foreignCount === 1 ? "transaction" : "transactions"} in another currency{" "}
        {foreignCount === 1 ? "is" : "are"} shown in the list but not added to NOK totals.
      </>,
    );
  }
  if (lines.length === 0) return null;
  return (
    <ul className="space-y-2">
      {lines.map((line, i) => (
        <li key={i} className="flex gap-2.5 text-xs leading-relaxed text-ink-2">
          <Info className="mt-0.5 size-3.5 shrink-0 text-ink-3" aria-hidden />
          <span>{line}</span>
        </li>
      ))}
    </ul>
  );
}

/** Unobtrusive reminder before (or after) bank access runs out. */
export function ConsentReminder({ connections, today }: { connections: ConnectionSummary[]; today: IsoDate }) {
  const due = connections.filter((c) => {
    if (c.status === "expired" || c.status === "revoked") return c.id !== "disconnected";
    if (!c.consentValidUntil) return false;
    return diffDays(c.consentValidUntil.slice(0, 10), today) <= CONSENT_REMINDER_DAYS;
  });
  if (due.length === 0) return null;
  return (
    <ul className="space-y-2">
      {due.map((c) => {
        const expired = c.status === "expired" || c.status === "revoked";
        const days = c.consentValidUntil ? diffDays(c.consentValidUntil.slice(0, 10), today) : 0;
        return (
          <li key={c.id}>
            <Link
              href={`/settings/accounts#${c.id}`}
              className="flex items-center justify-between gap-4 rounded-lg bg-ochre-soft px-5 py-3.5 text-sm transition-opacity hover:opacity-90"
            >
              <span>
                {expired ? (
                  <>
                    <span className="font-medium">{c.institutionName} access has ended.</span> Your history is safe; renew to keep syncing.
                  </>
                ) : (
                  <>
                    <span className="font-medium">{c.institutionName} access ends {days <= 0 ? "today" : `in ${days} ${days === 1 ? "day" : "days"}`}.</span>{" "}
                    Renewing takes a minute with BankID.
                  </>
                )}
              </span>
              <span className="shrink-0 font-medium underline underline-offset-4">Renew</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
