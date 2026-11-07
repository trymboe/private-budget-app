"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Plus, X } from "lucide-react";
import { addContribution, deleteContribution, deleteGoal, setGoalStatus } from "@/app/actions/goals";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import type { GoalContribution } from "@/lib/data/goals";
import { formatDay, type IsoDate } from "@/lib/dates";
import { formatMoney, minorToDecimalString } from "@/lib/money";
import { cn } from "@/lib/utils";

const QUICK = ["500", "1000", "2500"];

/** The main action on a goal: log money put aside (or taken out). */
export function LogSavingsButton({ goalId, goalName, today }: { goalId: string; goalName: string; today: IsoDate }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="accent" size="lg" block onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden /> Log savings
      </Button>
      <Sheet open={open} onOpenChange={setOpen} title="Log savings" description={goalName}>
        {open ? <ContributionForm goalId={goalId} today={today} onDone={() => setOpen(false)} /> : null}
      </Sheet>
    </>
  );
}

function ContributionForm({ goalId, today, onDone }: { goalId: string; today: IsoDate; onDone: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [direction, setDirection] = useState<"in" | "out">("in");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState<IsoDate>(today);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const r = await addContribution({ goalId, amount, direction, date, note });
      if (!r.ok) return setError(r.error);
      toast({ message: direction === "in" ? `+${amount.trim()} kr logged` : `−${amount.trim()} kr logged` });
      router.refresh();
      onDone();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-6 pt-1">
      <div className="grid grid-cols-2 gap-1 rounded-md bg-sunken p-1" role="radiogroup" aria-label="Direction">
        {(
          [
            ["in", "Put aside"],
            ["out", "Took out"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={direction === value}
            onClick={() => setDirection(value)}
            className={cn(
              "h-10 rounded-[7px] text-xs font-medium transition-colors",
              direction === value ? "bg-surface text-ink shadow-sm" : "text-ink-2 hover:text-ink",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        <Label htmlFor="contribution-amount">Amount (kr)</Label>
        <Input
          id="contribution-amount"
          inputMode="decimal"
          autoComplete="off"
          placeholder="500"
          className="tnum text-lg"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
          autoFocus
        />
        <div className="flex gap-2">
          {QUICK.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => setAmount(q)}
              className="tnum h-9 rounded-full px-3.5 text-xs text-ink-2 ring-1 ring-inset ring-line-strong hover:bg-sunken hover:text-ink"
            >
              {direction === "in" ? "+" : "−"}
              {Number(q).toLocaleString("nb-NO")} kr
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="contribution-date">Date</Label>
          <Input id="contribution-date" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="contribution-note">Note (optional)</Label>
          <Input id="contribution-note" maxLength={200} placeholder="e.g. Bonus" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>

      <FieldError>{error}</FieldError>
      <Button type="submit" block size="lg" disabled={pending || !amount.trim()}>
        {pending ? "Saving…" : "Log it"}
      </Button>
    </form>
  );
}

/** Logged contributions, newest first. Removing one offers Undo. */
export function ContributionList({
  goalId,
  contributions,
  names,
  today,
}: {
  goalId: string;
  contributions: GoalContribution[];
  /** Who logged what, shown in a shared space only. */
  names: Record<string, string> | null;
  today: IsoDate;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  function remove(c: GoalContribution) {
    startTransition(async () => {
      const r = await deleteContribution(c.id);
      if (!r.ok) return toast({ message: r.error, tone: "error" });
      router.refresh();
      toast({
        message: "Entry removed",
        action: {
          label: "Undo",
          onClick: () =>
            startTransition(async () => {
              const back = await addContribution({
                goalId,
                amount: minorToDecimalString(Math.abs(c.amountMinor)),
                direction: c.amountMinor < 0 ? "out" : "in",
                date: c.contributedOn,
                note: c.note ?? "",
              });
              if (!back.ok) toast({ message: back.error, tone: "error" });
              router.refresh();
            }),
        },
      });
    });
  }

  if (contributions.length === 0) {
    return <p className="mt-3 text-sm text-ink-2">Nothing logged yet.</p>;
  }
  return (
    <ul className="mt-2 divide-y divide-line">
      {contributions.map((c) => (
        <li key={c.id} className="flex items-center gap-3 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm">{c.note ?? (c.amountMinor < 0 ? "Taken out" : "Put aside")}</p>
            <p className="text-2xs text-ink-3">
              {formatDay(c.contributedOn, today)}
              {names && c.createdBy && names[c.createdBy] ? ` · ${names[c.createdBy]}` : ""}
            </p>
          </div>
          <span className={cn("tnum whitespace-nowrap text-sm", c.amountMinor > 0 ? "text-accent" : "text-ink-2")}>
            {formatMoney(c.amountMinor, "NOK", { signed: true })}
          </span>
          <button
            type="button"
            disabled={pending}
            onClick={() => remove(c)}
            aria-label={`Remove entry from ${formatDay(c.contributedOn, today)}`}
            className="-mr-2 grid size-10 shrink-0 place-items-center rounded-full text-ink-3 hover:bg-sunken hover:text-ink disabled:opacity-40"
          >
            <X className="size-4" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Complete, archive, restore and delete. Delete confirms first; the others can be undone. */
export function GoalStatusActions({
  goalId,
  goalName,
  status,
  reached,
}: {
  goalId: string;
  goalName: string;
  status: "active" | "completed" | "archived";
  reached: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function change(next: "active" | "completed" | "archived", message: string) {
    setError(null);
    startTransition(async () => {
      const r = await setGoalStatus(goalId, next);
      if (!r.ok) return setError(r.error);
      router.refresh();
      toast({
        message,
        action: {
          label: "Undo",
          onClick: () =>
            startTransition(async () => {
              await setGoalStatus(goalId, status);
              router.refresh();
            }),
        },
      });
    });
  }

  return (
    <div className="space-y-3">
      {status === "active" ? (
        <>
          <Button variant={reached ? "primary" : "secondary"} block disabled={pending} onClick={() => change("completed", `${goalName} completed`)}>
            {reached ? "Mark as completed" : "Mark as completed early"}
          </Button>
          <Button variant="secondary" block disabled={pending} onClick={() => change("archived", `${goalName} archived`)}>
            Archive
          </Button>
        </>
      ) : (
        <Button variant="secondary" block disabled={pending} onClick={() => change("active", `${goalName} is active again`)}>
          Make active again
        </Button>
      )}
      <Button
        variant="danger"
        block
        disabled={pending}
        onClick={() => {
          if (!confirm(`Delete ${goalName} and everything logged for it? This cannot be undone.`)) return;
          startTransition(async () => {
            const r = await deleteGoal(goalId);
            if (!r.ok) return setError(r.error);
            toast({ message: `${goalName} deleted` });
            router.push("/goals");
          });
        }}
      >
        Delete goal
      </Button>
      <FieldError>{error}</FieldError>
      <p className="text-center text-2xs text-ink-3">Completed and archived goals keep their history and can be made active again.</p>
    </div>
  );
}
