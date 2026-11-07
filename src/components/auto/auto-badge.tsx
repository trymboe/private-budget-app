import { Sparkle } from "lucide-react";
import { cn } from "@/lib/utils";

/** Marks a transaction that a trusted merchant rule filed by itself. */
export function AutoBadge({ className }: { className?: string }) {
  return (
    <span
      title="Filed automatically"
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded-sm bg-accent-soft px-1.5 text-[10px] leading-4 font-medium tracking-wide text-accent uppercase",
        className,
      )}
    >
      <Sparkle className="size-2.5" strokeWidth={2.25} aria-hidden />
      Auto
      <span className="sr-only">: filed automatically</span>
    </span>
  );
}
