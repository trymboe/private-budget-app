import { formatMoney, type Minor } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * A transaction amount. Tabular numerals so columns align. Incoming money gets a
 * + and the accent colour; outgoing money is the norm, so it stays plain ink
 * without a minus sign.
 */
export function Amount({
  minor,
  currency = "NOK",
  decimals = "auto",
  className,
}: {
  minor: Minor;
  currency?: string;
  decimals?: "auto" | "always" | "never";
  className?: string;
}) {
  const incoming = minor > 0;
  const text = (incoming ? "+" : "") + formatMoney(Math.abs(minor), currency, { decimals });
  return (
    <span className={cn("tnum whitespace-nowrap", incoming && "text-accent", className)}>
      <span className="sr-only">{incoming ? "Received " : "Spent "}</span>
      {text}
    </span>
  );
}

/** A plain figure (budgets, totals). Whole kroner by default. */
export function Money({
  minor,
  currency = "NOK",
  decimals = "never",
  className,
}: {
  minor: Minor;
  currency?: string;
  decimals?: "auto" | "always" | "never";
  className?: string;
}) {
  return <span className={cn("tnum whitespace-nowrap", className)}>{formatMoney(minor, currency, { decimals })}</span>;
}
