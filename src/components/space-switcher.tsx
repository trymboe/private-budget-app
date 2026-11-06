"use client";

import { useRouter } from "next/navigation";
import { useOptimistic, useTransition } from "react";
import { setActiveSpace } from "@/app/actions/spaces";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

export type SpaceOption = { id: string; label: string };

/**
 * Mine / Shared. Only shown once a shared space exists. Everything below it
 * (home, transactions, budget, insights) follows the chosen space.
 */
export function SpaceSwitcher({ options, activeId, className }: { options: SpaceOption[]; activeId: string; className?: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [current, setCurrent] = useOptimistic(activeId);
  if (options.length < 2) return null;
  return (
    <div role="radiogroup" aria-label="Budget" className={cn("grid grid-flow-col auto-cols-fr rounded-lg bg-sunken p-1", className)}>
      {options.map((o) => {
        const active = o.id === current;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={pending && !active}
            onClick={() => {
              if (active) return;
              startTransition(async () => {
                setCurrent(o.id);
                const r = await setActiveSpace(o.id);
                if (!r.ok) toast({ message: r.error, tone: "error" });
                router.refresh();
              });
            }}
            className={cn(
              "h-8 truncate rounded-md px-3 text-xs font-medium transition-colors",
              active ? "bg-surface text-ink shadow-sm ring-1 ring-line" : "text-ink-2 hover:text-ink",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
