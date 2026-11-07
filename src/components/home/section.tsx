import Link from "next/link";
import { SectionLabel } from "@/components/ui/field";
import { cn } from "@/lib/utils";

// Building blocks for Home. Every block on Home is a HomeSection (a labelled
// group with an optional link on the right) and, when it needs a frame, a
// HomeCard. A new feature adds one HomeSection in the right place in
// home-view.tsx and gets the same spacing and type as the rest.

export function HomeSection({
  id,
  title,
  action,
  children,
  className,
}: {
  /** Used for the heading id (`${id}-heading`) and as an anchor. */
  id: string;
  title: React.ReactNode;
  /** A quiet link or note on the right of the heading. */
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className={cn("scroll-mt-6", className)}>
      <div className="flex min-h-6 items-baseline justify-between gap-4">
        <SectionLabel id={`${id}-heading`}>{title}</SectionLabel>
        {action ? <div className="shrink-0 text-xs text-ink-3">{action}</div> : null}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** A framed card on Home: surface on paper, hairline ring, generous padding. */
export function HomeCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("rounded-xl bg-surface px-5 py-5 ring-1 ring-line", className)}>{children}</div>;
}

/** The small text link used in section headers ("Edit budget", "Accounts"). */
export function SectionLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-xs text-ink-2 underline-offset-4 hover:text-ink hover:underline">
      {children}
    </Link>
  );
}
