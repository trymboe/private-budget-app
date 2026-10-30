import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/** Page frame: one readable column on phones, a wider measured column on desktop. */
export function Page({ children, className, wide = false }: { children: React.ReactNode; className?: string; wide?: boolean }) {
  return (
    <main className={cn("mx-auto w-full px-5 pt-[max(1.5rem,env(safe-area-inset-top))] pb-10 sm:px-8 lg:pt-12", wide ? "max-w-5xl" : "max-w-2xl", className)}>
      {children}
    </main>
  );
}

export function PageHeader({
  title,
  eyebrow,
  back,
  actions,
}: {
  title: React.ReactNode;
  eyebrow?: React.ReactNode;
  back?: { href: string; label: string };
  actions?: React.ReactNode;
}) {
  return (
    <header className="mb-8">
      {back ? (
        <Link href={back.href} className="-ml-2 mb-4 inline-flex h-9 items-center gap-1 rounded-md px-2 text-sm text-ink-2 hover:text-ink">
          <ChevronLeft className="size-4" aria-hidden />
          {back.label}
        </Link>
      ) : null}
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          {eyebrow ? <p className="eyebrow mb-2">{eyebrow}</p> : null}
          <h1 className="font-display text-xl leading-none tracking-tight sm:text-2xl">{title}</h1>
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
      </div>
    </header>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="border-y border-line py-12 text-center">
      <p className="font-display text-lg">{title}</p>
      {children ? <div className="mx-auto mt-2 max-w-xs text-sm text-ink-2">{children}</div> : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}
