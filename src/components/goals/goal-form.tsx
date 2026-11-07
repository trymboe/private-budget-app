"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { createGoal, updateGoal, type GoalInput } from "@/app/actions/goals";
import { CATEGORY_COLORS, CategoryIcon, categoryColorVar } from "@/components/category-icon";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import type { IsoDate } from "@/lib/dates";
import { minorToDecimalString } from "@/lib/money";
import { cn } from "@/lib/utils";

/** Icons that suit something you save for, from the same curated set as categories. */
const GOAL_ICONS = [
  "piggy-bank",
  "plane",
  "house",
  "car",
  "bike",
  "gift",
  "baby",
  "graduation-cap",
  "sofa",
  "smartphone",
  "heart-pulse",
  "music",
  "dog",
  "palette",
  "book-open",
  "shirt",
] as const;

export type LinkableAccount = { id: string; name: string; isSavings: boolean; hasBalance: boolean };

export type EditableGoal = {
  id: string;
  name: string;
  targetMinor: number;
  targetDate: IsoDate | null;
  startsOn: IsoDate;
  icon: string;
  color: string;
  accountId: string | null;
  accountBasis: "growth" | "balance";
};

export function NewGoalButton({
  accounts,
  today,
  spaceNote,
  variant = "secondary",
  block = false,
}: {
  accounts: LinkableAccount[];
  today: IsoDate;
  spaceNote: string;
  variant?: "secondary" | "accent";
  block?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} size={block ? "lg" : "sm"} block={block} onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden /> New goal
      </Button>
      <Sheet open={open} onOpenChange={setOpen} title="New savings goal" description={spaceNote}>
        {open ? <GoalForm accounts={accounts} today={today} onDone={() => setOpen(false)} /> : null}
      </Sheet>
    </>
  );
}

export function EditGoalButton({ goal, accounts, today }: { goal: EditableGoal; accounts: LinkableAccount[]; today: IsoDate }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" block onClick={() => setOpen(true)}>
        Edit goal
      </Button>
      <Sheet open={open} onOpenChange={setOpen} title="Edit goal">
        {open ? <GoalForm goal={goal} accounts={accounts} today={today} onDone={() => setOpen(false)} /> : null}
      </Sheet>
    </>
  );
}

function GoalForm({
  goal,
  accounts,
  today,
  onDone,
}: {
  goal?: EditableGoal;
  accounts: LinkableAccount[];
  today: IsoDate;
  onDone: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<GoalInput>({
    name: goal?.name ?? "",
    target: goal ? minorToDecimalString(goal.targetMinor).replace(/\.00$/, "").replace(".", ",") : "",
    targetDate: goal?.targetDate ?? "",
    icon: goal?.icon ?? "piggy-bank",
    color: goal?.color ?? "pine",
    accountId: goal?.accountId ?? "",
    accountBasis: goal?.accountBasis ?? "growth",
    startsOn: goal?.startsOn ?? today,
  });
  const set = (patch: Partial<GoalInput>) => setDraft((d) => ({ ...d, ...patch }));
  const linked = accounts.find((a) => a.id === draft.accountId);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const r = goal ? await updateGoal(goal.id, draft) : await createGoal(draft);
      if (!r.ok) return setError(r.error);
      toast({ message: goal ? "Goal saved" : `${draft.name.trim()} added` });
      onDone();
      if (!goal && "id" in r && r.id) router.push(`/goals/${r.id}`);
      else router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-6 pt-2">
      <div className="space-y-2">
        <Label htmlFor="goal-name">What are you saving for?</Label>
        <Input
          id="goal-name"
          value={draft.name}
          maxLength={60}
          required
          placeholder="e.g. Summer in Italy"
          onChange={(e) => set({ name: e.target.value })}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="goal-target">Target (kr)</Label>
          <Input
            id="goal-target"
            inputMode="decimal"
            autoComplete="off"
            placeholder="30 000"
            className="tnum"
            value={draft.target}
            required
            onChange={(e) => set({ target: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="goal-date">By (optional)</Label>
          <Input
            id="goal-date"
            type="date"
            min={goal ? undefined : today}
            value={draft.targetDate}
            onChange={(e) => set({ targetDate: e.target.value })}
          />
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-ink-2">Track progress from</legend>
        <select
          aria-label="Linked account"
          value={draft.accountId}
          onChange={(e) => set({ accountId: e.target.value })}
          className="mt-2 h-12 w-full rounded-md bg-surface px-3 text-sm ring-1 ring-inset ring-line-strong"
        >
          <option value="">Only what I log by hand</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {a.isSavings ? " (savings)" : ""}
            </option>
          ))}
        </select>
        {draft.accountId ? (
          <div className="space-y-4 rounded-md bg-sunken/60 p-3.5">
            <div className="grid grid-cols-2 gap-1 rounded-md bg-sunken p-1" role="radiogroup" aria-label="What counts">
              {(
                [
                  ["growth", "Money in from a date"],
                  ["balance", "Whole balance"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={draft.accountBasis === value}
                  onClick={() => set({ accountBasis: value })}
                  className={cn(
                    "h-10 rounded-[7px] text-xs font-medium transition-colors",
                    draft.accountBasis === value ? "bg-surface text-ink shadow-sm" : "text-ink-2 hover:text-ink",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            {draft.accountBasis === "growth" ? (
              <div className="space-y-2">
                <Label htmlFor="goal-start">Count deposits and withdrawals from</Label>
                <Input id="goal-start" type="date" max={today} value={draft.startsOn} required onChange={(e) => set({ startsOn: e.target.value })} />
                <p className="text-xs text-ink-3">Pick an earlier date to include money you have already put aside.</p>
              </div>
            ) : (
              <p className="text-xs text-ink-2">
                {linked?.hasBalance
                  ? "The account's balance counts toward the goal. Best when the account is only for this goal."
                  : "The bank has not reported a balance for this account yet. Until it does, money in since the start date is shown instead."}
              </p>
            )}
          </div>
        ) : (
          <p className="text-xs text-ink-3">You can log savings as you go, like “+500 kr”.</p>
        )}
      </fieldset>

      <fieldset>
        <legend className="text-xs font-medium text-ink-2">Colour</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {CATEGORY_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => set({ color })}
              aria-label={color}
              aria-pressed={draft.color === color}
              className={cn("size-9 rounded-full ring-offset-2 ring-offset-surface transition", draft.color === color && "ring-2 ring-ink")}
              style={{ backgroundColor: categoryColorVar(color) }}
            />
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-xs font-medium text-ink-2">Icon</legend>
        <div className="mt-2 grid grid-cols-8 gap-1">
          {GOAL_ICONS.map((icon) => (
            <button
              key={icon}
              type="button"
              onClick={() => set({ icon })}
              aria-label={icon.replace(/-/g, " ")}
              aria-pressed={draft.icon === icon}
              className={cn(
                "grid aspect-square place-items-center rounded-md text-ink-2 hover:bg-sunken",
                draft.icon === icon && "bg-ink text-paper hover:bg-ink",
              )}
            >
              <CategoryIcon icon={icon} />
            </button>
          ))}
        </div>
      </fieldset>

      <FieldError>{error}</FieldError>
      <Button type="submit" block size="lg" disabled={pending || !draft.name.trim() || !draft.target.trim()}>
        {pending ? "Saving…" : goal ? "Save" : "Create goal"}
      </Button>
    </form>
  );
}
