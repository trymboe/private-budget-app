import { cn } from "@/lib/utils";
import type { CategoryStatus } from "@/lib/budget";

const FILL: Record<CategoryStatus | "neutral", string> = {
  comfortable: "bg-accent",
  approaching: "bg-ochre",
  over: "bg-brick",
  unbudgeted: "bg-ink-3",
  neutral: "bg-ink",
};

/**
 * Thin budget bar. `marker` (0-100) draws a tick for where steady spending would
 * be today, so the bar answers "am I ahead or behind?" without extra text.
 */
export function BudgetBar({
  percent,
  status = "comfortable",
  marker,
  size = "sm",
  label,
  className,
}: {
  percent: number;
  status?: CategoryStatus | "neutral";
  marker?: number | null;
  size?: "sm" | "md";
  label: string;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.max(0, Math.round(percent))}
      className={cn("relative w-full overflow-visible", className)}
    >
      <div className={cn("w-full overflow-hidden rounded-full bg-sunken", size === "md" ? "h-2" : "h-1")}>
        <div className={cn("h-full rounded-full animate-bar", FILL[status])} style={{ width: `${clamped}%` }} />
      </div>
      {marker !== undefined && marker !== null && marker > 0 && marker < 100 ? (
        <div
          aria-hidden
          className={cn("absolute top-1/2 w-px -translate-y-1/2 bg-ink", size === "md" ? "h-4" : "h-3")}
          style={{ left: `${marker}%` }}
        />
      ) : null}
    </div>
  );
}
