import Link from "next/link";
import { ArrowRight, Sparkle } from "lucide-react";
import type { AutoFiledSummary } from "@/lib/auto-categorise";
import { cn } from "@/lib/utils";

/** "Filed automatically this week": a quiet link to check what trusted merchants filed. */
export function AutoFiledNotice({ summary, className }: { summary: AutoFiledSummary | null | undefined; className?: string }) {
  if (!summary || summary.count === 0) return null;
  const shown = summary.merchants.slice(0, 2);
  const more = summary.merchants.length - shown.length;
  const who = more > 0 ? `${shown.join(", ")} and ${more} more` : shown.join(" and ");
  return (
    <Link
      href="/transactions?view=auto"
      className={cn(
        "flex items-center justify-between gap-4 rounded-lg px-5 py-3.5 ring-1 ring-inset ring-line transition-colors hover:bg-sunken/50",
        className,
      )}
    >
      <span className="flex min-w-0 gap-3">
        <Sparkle className="mt-0.5 size-4 shrink-0 text-accent" strokeWidth={1.75} aria-hidden />
        <span className="min-w-0">
          <span className="block text-sm font-medium">
            {summary.count} {summary.count === 1 ? "transaction" : "transactions"} filed automatically
            {summary.days === 7 ? " this week" : ` in ${summary.days} days`}
          </span>
          <span className="mt-0.5 block truncate text-xs text-ink-2">{who} · check them</span>
        </span>
      </span>
      <ArrowRight className="size-5 shrink-0 text-ink-2" aria-hidden />
    </Link>
  );
}
