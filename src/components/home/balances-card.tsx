import { Fragment } from "react";
import { Info } from "lucide-react";
import { Money } from "@/components/ui/amount";
import { formatAge, type BalanceGroup, type BalanceLine, type BalanceOverview } from "@/lib/balances";
import { formatShortDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { HomeCard } from "./section";

const KIND_LABEL = { booked: "Booked", available: "Available", expected: "Expected" } as const;

/**
 * Money in accounts: one NOK total, then each account with what the bank said and
 * when. Accounts outside the budget (savings) sit in their own well below.
 */
export function BalancesCard({ overview, now }: { overview: BalanceOverview; now: Date }) {
  const { budget, other, currency } = overview;
  const grouped = budget.lines.length > 0 && other.lines.length > 0;
  const notes: string[] = [];
  if (overview.foreign > 0) {
    notes.push(
      `${overview.foreign} ${overview.foreign === 1 ? "account is" : "accounts are"} in another currency: listed in ${overview.foreign === 1 ? "its" : "their"} own currency, not added to the ${currency} total.`,
    );
  }
  if (overview.missing > 0 && overview.counted > 0) {
    notes.push(
      `${overview.missing} ${overview.missing === 1 ? "account has" : "accounts have"} no balance from the bank yet, so the total leaves ${overview.missing === 1 ? "it" : "them"} out.`,
    );
  }
  if (overview.stale > 0) {
    notes.push(
      `${overview.stale === 1 ? "One balance is" : `${overview.stale} balances are`} older than the last day or two; the bank may have moved on since.`,
    );
  }

  return (
    <HomeCard>
      {overview.counted > 0 ? (
        <>
          <p className="font-display text-xl leading-none tracking-tight">
            <Money minor={overview.total} currency={currency} />
          </p>
          <p className="mt-2 text-xs text-ink-2">
            {overview.counted === 1 ? "In 1 account" : `Across ${overview.counted} accounts`}
            {overview.oldestAt && overview.newestAt ? (
              <>
                {" "}
                ·{" "}
                {formatAge(overview.oldestAt, now) === formatAge(overview.newestAt, now) ? (
                  <span className={cn(overview.stale > 0 && "text-ochre")}>updated {formatAge(overview.oldestAt, now)}</span>
                ) : (
                  // Say how old the oldest figure in the total is, not just the newest.
                  <>
                    updated {formatAge(overview.newestAt, now)},{" "}
                    <span className={cn("whitespace-nowrap", overview.stale > 0 && "text-ochre")}>oldest {formatAge(overview.oldestAt, now)}</span>
                  </>
                )}
              </>
            ) : null}
          </p>
        </>
      ) : (
        <p className="text-sm text-ink-2">The bank has not reported a balance for these accounts yet. It arrives with the next sync.</p>
      )}

      {budget.lines.length > 0 ? (
        <Group
          title={grouped ? "Counted in the budget" : null}
          group={budget}
          currency={currency}
          now={now}
          className="mt-5 border-t border-line pt-1"
        />
      ) : null}
      {other.lines.length > 0 ? (
        <div className={cn("rounded-lg bg-sunken/60 px-4 pb-1", grouped ? "mt-4 pt-3" : "mt-5 pt-1")}>
          <Group
            title="Not in the budget"
            hint="Savings and other accounts you keep out of the budget."
            group={other}
            currency={currency}
            now={now}
          />
        </div>
      ) : null}

      {notes.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {notes.map((n) => (
            <li key={n} className="flex gap-2.5 text-2xs leading-relaxed text-ink-2">
              <Info className="mt-0.5 size-3.5 shrink-0 text-ink-3" aria-hidden />
              <span>{n}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </HomeCard>
  );
}

function Group({
  title,
  hint,
  group,
  currency,
  now,
  className,
}: {
  title: string | null;
  hint?: string;
  group: BalanceGroup;
  currency: string;
  now: Date;
  className?: string;
}) {
  return (
    <div className={className}>
      {title ? (
        <div className="pt-2">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-2xs font-medium text-ink-2">{title}</p>
            {group.counted > 0 ? <Money minor={group.total} currency={currency} className="text-2xs text-ink-2" /> : null}
          </div>
          {hint ? <p className="text-2xs text-ink-3">{hint}</p> : null}
        </div>
      ) : null}
      <ul className="divide-y divide-line">
        {group.lines.map((line) => (
          <AccountRow key={line.id} line={line} currency={currency} now={now} />
        ))}
      </ul>
    </div>
  );
}

function AccountRow({ line, currency, now }: { line: BalanceLine; currency: string; now: Date }) {
  const foreign = line.currency !== currency;
  const detail: string[] = [line.institutionName];
  if (line.balanceMinor === null) {
    detail.push("no balance yet");
  } else {
    const kind = line.kind ? KIND_LABEL[line.kind] : "Balance";
    detail.push(line.asOf ? `${kind} for ${formatShortDate(line.asOf)}` : kind);
    if (line.balanceAt) detail.push(`updated ${formatAge(line.balanceAt, now)}`);
    if (line.connectionEnded) detail.push("bank access ended");
    if (foreign) detail.push(`not in ${currency} total`);
  }
  return (
    <li className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm">{line.name}</p>
        <p className={cn("mt-0.5 text-2xs leading-snug", line.stale ? "text-ochre" : "text-ink-3")}>
          {detail.map((d, i) => (
            <Fragment key={d}>
              {i > 0 ? " · " : null}
              <span className="whitespace-nowrap">{d}</span>
            </Fragment>
          ))}
        </p>
      </div>
      {line.balanceMinor === null ? (
        <span className="shrink-0 text-sm text-ink-3" aria-label="No balance yet">
          –
        </span>
      ) : (
        <Money
          minor={line.balanceMinor}
          currency={line.currency}
          className={cn("shrink-0 text-sm", foreign || line.stale ? "text-ink-2" : "text-ink")}
        />
      )}
    </li>
  );
}
