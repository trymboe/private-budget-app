"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import { finishOnboarding, saveInitialBudget } from "@/app/actions/budget";
import { CategoryMark } from "@/components/category-icon";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import type { Category } from "@/lib/data/types";
import { formatMonth, type IsoDate } from "@/lib/dates";
import { formatMoney, minorToDecimalString, parseDecimalToMinor } from "@/lib/money";
import { cn } from "@/lib/utils";

// Typical Oslo single-person amounts as a starting point; every one is editable.
const SUGGESTED: Record<string, number> = {
  Groceries: 450_000,
  "Restaurants & cafés": 150_000,
  Transport: 90_000,
  Housing: 1_300_000,
  Shopping: 150_000,
  Entertainment: 80_000,
  Travel: 100_000,
  Health: 50_000,
  Subscriptions: 60_000,
  Miscellaneous: 100_000,
};

export function WelcomeSteps({
  month,
  bankConnected,
  budgetDone,
  categories,
  budgets,
  reviewCount,
}: {
  month: IsoDate;
  bankConnected: boolean;
  budgetDone: boolean;
  categories: Category[];
  budgets: Record<string, number>;
  reviewCount: number;
}) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(!bankConnected ? 1 : !budgetDone ? 2 : 3);
  const [bankSkipped, setBankSkipped] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      categories.map((c) => {
        const v = budgets[c.id] ?? SUGGESTED[c.name] ?? 0;
        return [c.id, v ? minorToDecimalString(v).replace(/\.00$/, "") : ""];
      }),
    ),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const total = Object.values(values).reduce((s, v) => {
    try {
      return s + (v.trim() ? parseDecimalToMinor(v) : 0);
    } catch {
      return s;
    }
  }, 0);

  return (
    <ol className="mt-10 space-y-3">
      <Step n={1} title="Connect your bank" done={bankConnected} skipped={bankSkipped} open={step === 1} onOpen={() => setStep(1)}>
        <p className="text-sm text-ink-2">
          Read-only access through Enable Banking. You approve it at your bank with BankID; we never see your login. Transactions then
          arrive by themselves every morning.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button asChild size="lg">
            <Link href="/settings/connect">Connect a bank</Link>
          </Button>
          <Button
            variant="ghost"
            size="lg"
            onClick={() => {
              setBankSkipped(true);
              setStep(2);
            }}
          >
            Later
          </Button>
        </div>
      </Step>

      <Step n={2} title="Set this month’s budget" done={budgetDone} open={step === 2} onOpen={() => setStep(2)}>
        <p className="text-sm text-ink-2">
          A starting point for {formatMonth(month)}. Adjust the amounts, leave any at zero, and rename or add categories later.
        </p>
        <ul className="mt-5 divide-y divide-line">
          {categories.map((c) => (
            <li key={c.id} className="flex items-center gap-3 py-2.5">
              <CategoryMark icon={c.icon} color={c.color} size="sm" />
              <label htmlFor={`ob-${c.id}`} className="flex-1 text-sm">
                {c.name}
              </label>
              <div className="relative">
                <input
                  id={`ob-${c.id}`}
                  inputMode="decimal"
                  autoComplete="off"
                  value={values[c.id] ?? ""}
                  placeholder="0"
                  onChange={(e) => setValues((v) => ({ ...v, [c.id]: e.target.value }))}
                  className="tnum h-10 w-28 rounded-md bg-surface pr-8 pl-3 text-right text-sm ring-1 ring-inset ring-line focus:outline-none focus:ring-2 focus:ring-accent"
                />
                <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-ink-3">kr</span>
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex items-baseline justify-between border-t border-line pt-4">
          <span className="text-sm text-ink-2">Total</span>
          <span className="tnum font-display text-xl">{formatMoney(total, "NOK", { decimals: "never" })}</span>
        </div>
        <FieldError>{error}</FieldError>
        <Button
          className="mt-5"
          size="lg"
          block
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const r = await saveInitialBudget(month, values);
              if (!r.ok) return setError(r.error);
              setStep(3);
              router.refresh();
            })
          }
        >
          {pending ? "Saving…" : "Save budget"}
        </Button>
      </Step>

      <Step n={3} title="Categorise and start" done={false} open={step === 3} onOpen={() => setStep(3)}>
        <p className="text-sm text-ink-2">
          {reviewCount > 0
            ? `${reviewCount} imported ${reviewCount === 1 ? "transaction is" : "transactions are"} waiting. Each one is a single tap, and the app learns your merchants as you go.`
            : "When transactions arrive, they wait in a short review queue. Each one is a single tap."}
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          {reviewCount > 0 ? (
            <Button
              size="lg"
              onClick={() =>
                startTransition(async () => {
                  await finishOnboarding();
                  router.push("/review");
                })
              }
            >
              Start reviewing
            </Button>
          ) : null}
          <Button
            size="lg"
            variant={reviewCount > 0 ? "ghost" : "primary"}
            onClick={() =>
              startTransition(async () => {
                await finishOnboarding();
                router.push("/");
              })
            }
          >
            Go to my month
          </Button>
        </div>
      </Step>
    </ol>
  );
}

function Step({
  n,
  title,
  done,
  skipped,
  open,
  onOpen,
  children,
}: {
  n: number;
  title: string;
  done: boolean;
  skipped?: boolean;
  open: boolean;
  onOpen: () => void;
  children: React.ReactNode;
}) {
  return (
    <li className={cn("rounded-lg ring-1 transition-colors", open ? "bg-surface ring-line-strong" : "ring-line")}>
      <button type="button" onClick={onOpen} aria-expanded={open} className="flex w-full items-center gap-4 px-5 py-4 text-left">
        <span
          className={cn(
            "grid size-7 shrink-0 place-items-center rounded-full text-xs font-medium",
            done ? "bg-accent text-accent-ink" : open ? "bg-ink text-paper" : "bg-sunken text-ink-2",
          )}
          aria-hidden
        >
          {done ? <Check className="size-4" /> : n}
        </span>
        <span className="flex-1 text-sm font-medium">{title}</span>
        {done ? <span className="text-xs text-ink-3">Done</span> : skipped ? <span className="text-xs text-ink-3">Skipped</span> : null}
      </button>
      {open ? <div className="px-5 pb-5 animate-fade-up">{children}</div> : null}
    </li>
  );
}
