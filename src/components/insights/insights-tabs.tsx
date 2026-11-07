import Link from "next/link";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/insights", label: "Overview", key: "overview" },
  { href: "/insights/months", label: "Month over month", key: "months" },
] as const;

/** Switch between the Insights overview and the month-over-month table. */
export function InsightsTabs({ active }: { active: (typeof TABS)[number]["key"] }) {
  return (
    <nav aria-label="Insights views" className="-mt-4 mb-8 flex gap-1 rounded-lg bg-surface p-1 ring-1 ring-line sm:w-max">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === active ? "page" : undefined}
          className={cn(
            "flex h-9 flex-1 items-center justify-center rounded-md px-4 text-xs font-medium",
            t.key === active ? "bg-ink text-paper" : "text-ink-2 hover:bg-sunken/70 hover:text-ink",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
