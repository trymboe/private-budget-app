import { APP_NAME } from "@/lib/brand";
import { cn } from "@/lib/utils";

/** The å mark, drawn with theme tokens so it follows light and dark mode. Same shape as app/icon.svg. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden className={cn("size-7 shrink-0", className)}>
      <rect width="64" height="64" rx="15" fill="var(--accent)" />
      <g fill="none" stroke="var(--accent-ink)" strokeLinecap="round">
        <circle cx="31.5" cy="40" r="10.5" strokeWidth="5" />
        <path d="M42 30v20.5" strokeWidth="5" />
        <circle cx="33.5" cy="16.5" r="4.25" strokeWidth="3" />
      </g>
    </svg>
  );
}

/** Mark plus wordmark. */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5 font-display text-xl tracking-tight", className)}>
      <LogoMark />
      {APP_NAME}
    </span>
  );
}
