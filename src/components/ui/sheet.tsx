"use client";

import { Drawer } from "vaul";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

// Bottom sheet on phones; on larger screens the same sheet is a centred panel.
// Built on vaul (Radix Dialog under the hood): focus trap, Escape, aria-modal.

export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} repositionInputs={false}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px]" />
        <Drawer.Content
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[92dvh] w-full max-w-lg flex-col rounded-t-xl bg-surface outline-none sm:bottom-6 sm:rounded-xl sm:shadow-[0_20px_60px_-20px_rgba(0,0,0,0.35)]",
            className,
          )}
        >
          <div aria-hidden className="mx-auto mt-2.5 h-1 w-9 shrink-0 rounded-full bg-line-strong sm:hidden" />
          <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-2">
            <div className="min-w-0">
              <Drawer.Title className="text-base font-semibold text-ink">{title}</Drawer.Title>
              {description ? (
                <Drawer.Description className="mt-0.5 text-xs text-ink-2">{description}</Drawer.Description>
              ) : (
                <Drawer.Description className="sr-only">{title}</Drawer.Description>
              )}
            </div>
            <Drawer.Close
              className="-mr-2 -mt-1 grid size-10 shrink-0 place-items-center rounded-full text-ink-2 hover:bg-sunken"
              aria-label="Close"
            >
              <X className="size-5" aria-hidden />
            </Drawer.Close>
          </div>
          <div className="overflow-y-auto overscroll-contain px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            {children}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
