"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Repeat } from "lucide-react";
import { trackTransactionAsSubscription } from "@/app/actions/subscriptions";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { TransactionListItem } from "@/lib/data/types";
import { CADENCES, CADENCE_LABEL, type Cadence } from "@/lib/subscriptions";

const SHORT: Record<Cadence, string> = { weekly: "Weekly", monthly: "Monthly", quarterly: "Quarterly", yearly: "Yearly" };

/** "Track as subscription" in the transaction sheet: pick how often, and it is added. */
export function TrackSubscription({ tx }: { tx: TransactionListItem }) {
  const router = useRouter();
  const toast = useToast();
  const [choosing, setChoosing] = useState(false);
  const [added, setAdded] = useState(false);
  const [pending, startTransition] = useTransition();
  if (tx.amountMinor >= 0 || tx.currency !== "NOK" || tx.treatment === "transfer") return null;

  function track(cadence: Cadence) {
    startTransition(async () => {
      const result = await trackTransactionAsSubscription(tx.id, cadence);
      if (!result.ok) {
        toast({ message: result.error, tone: "error" });
        return;
      }
      setChoosing(false);
      setAdded(true);
      toast({ message: `Added as a ${CADENCE_LABEL[cadence].adjective.toLowerCase()} subscription` });
      router.refresh();
    });
  }

  if (added) {
    return (
      <p className="text-xs text-ink-2">
        Tracked under{" "}
        <Link href="/subscriptions" className="underline underline-offset-4 hover:text-ink">
          Subscriptions
        </Link>
        .
      </p>
    );
  }
  if (!choosing) {
    return (
      <Button variant="secondary" block onClick={() => setChoosing(true)}>
        <Repeat className="size-4" aria-hidden />
        Track as subscription
      </Button>
    );
  }
  return (
    <div>
      <p className="text-xs font-medium text-ink-2">How often is it charged?</p>
      <div className="mt-2 grid grid-cols-4 gap-1 rounded-md bg-sunken p-1" role="group" aria-label="How often">
        {CADENCES.map((c) => (
          <button
            key={c}
            type="button"
            disabled={pending}
            onClick={() => track(c)}
            className="h-10 rounded-[7px] text-xs font-medium text-ink-2 transition-colors hover:bg-surface hover:text-ink disabled:opacity-50"
          >
            {SHORT[c]}
          </button>
        ))}
      </div>
    </div>
  );
}
