"use client";

import Link from "next/link";
import { useCallback, useTransition } from "react";
import { Sparkle, X } from "lucide-react";
import { updateMerchantRule } from "@/app/actions/auto";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { AUTO_THRESHOLD, type RuleChange } from "@/lib/auto-categorise";
import type { Category } from "@/lib/data/types";

/** Undo for a rule change: turn a new automatic merchant off, or keep the old rule after a one-off correction. */
function useRevertRule() {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const revert = useCallback(
    (change: RuleChange, merchant: string, categoryName: (id: string) => string, onDone?: () => void) =>
      startTransition(async () => {
        const result =
          change.kind === "now_auto"
            ? await updateMerchantRule(change.ruleId, { autoEnabled: false })
            : await updateMerchantRule(change.ruleId, {
                categoryId: change.previous.categoryId,
                confirmations: change.previous.confirmations,
              });
        if (!result.ok) return toast({ message: result.error, tone: "error" });
        toast({
          message:
            change.kind === "now_auto"
              ? `${merchant} will be suggested, not filed`
              : `${merchant} stays automatic as ${categoryName(change.previous.categoryId)}`,
        });
        onDone?.();
      }),
    [toast],
  );
  return { revert, pending };
}

/**
 * Shown in the review flow right after a decision changed a merchant's automatic
 * filing. Persistent (not a toast) so it does not push away the decision's Undo.
 */
export function RuleNotice({
  change,
  merchant,
  categories,
  onDismiss,
}: {
  change: RuleChange;
  merchant: string;
  categories: Map<string, Category>;
  onDismiss: () => void;
}) {
  const { revert, pending } = useRevertRule();
  const name = (id: string) => categories.get(id)?.name ?? "that category";
  return (
    <div role="status" className="flex gap-3 rounded-lg bg-accent-soft px-4 py-3.5 text-sm animate-fade-up">
      <Sparkle className="mt-0.5 size-4 shrink-0 text-accent" strokeWidth={1.75} aria-hidden />
      <div className="min-w-0 flex-1">
        {change.kind === "now_auto" ? (
          <>
            <p className="font-medium">
              {merchant} will now be filed as {name(change.categoryId)} automatically.
            </p>
            <p className="mt-1 text-xs leading-relaxed text-ink-2">
              New transactions from {merchant} skip review and are marked Auto, so you can still correct them.
            </p>
          </>
        ) : (
          <>
            <p className="font-medium">{merchant} is no longer filed automatically.</p>
            <p className="mt-1 text-xs leading-relaxed text-ink-2">
              You chose {name(change.categoryId)} instead of {name(change.previous.categoryId)}. It becomes automatic again after{" "}
              {AUTO_THRESHOLD} times in the same category.
            </p>
          </>
        )}
        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1">
          <Button
            variant="quiet"
            size="sm"
            className="-ml-1 h-8 px-1 font-medium text-ink underline-offset-4 hover:underline"
            disabled={pending}
            onClick={() => revert(change, merchant, name, onDismiss)}
          >
            {change.kind === "now_auto" ? "Turn off" : `Just this once, keep ${name(change.previous.categoryId)}`}
          </Button>
          <Link href="/settings/auto-categorise" className="text-xs text-ink-2 underline-offset-4 hover:text-ink hover:underline">
            Manage
          </Link>
        </div>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="-mt-1 -mr-1.5 grid size-8 shrink-0 place-items-center rounded-full text-ink-2 hover:bg-surface/60 hover:text-ink"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}

/** The same news as a toast, for places with no room for a notice (the transaction sheet). */
export function useRuleChangeToast() {
  const toast = useToast();
  const { revert } = useRevertRule();
  return useCallback(
    (change: RuleChange, merchant: string, categories: Map<string, Category>) => {
      const name = (id: string) => categories.get(id)?.name ?? "that category";
      toast({
        message: change.kind === "now_auto" ? `${merchant} is now automatic` : `${merchant} is no longer automatic`,
        action: {
          label: change.kind === "now_auto" ? "Turn off" : "Just this once",
          onClick: () => revert(change, merchant, name),
        },
      });
    },
    [revert, toast],
  );
}
