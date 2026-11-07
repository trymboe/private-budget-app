"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { ChevronRight, CircleDashed } from "lucide-react";
import { forgetMerchantRule, setAutoCategorize, updateMerchantRule } from "@/app/actions/auto";
import { CategoryMark } from "@/components/category-icon";
import { CategoryGrid } from "@/components/transactions/category-grid";
import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { AUTO_THRESHOLD, type AutoMerchant, type AutoSettings } from "@/lib/auto-categorise";
import type { Category } from "@/lib/data/types";
import { cn } from "@/lib/utils";
import { AutoBadge } from "./auto-badge";

/** The space-wide switch and the list of trusted merchants, each editable in a sheet. */
export function AutoMerchants({ settings, categories }: { settings: AutoSettings; categories: Category[] }) {
  const router = useRouter();
  const toast = useToast();
  const [enabled, setEnabled] = useState(settings.enabled);
  const [merchants, setMerchants] = useState(settings.merchants);
  const [openId, setOpenId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  // New server data (after a save): start over from it.
  const [source, setSource] = useState(settings);
  if (source !== settings) {
    setSource(settings);
    setEnabled(settings.enabled);
    setMerchants(settings.merchants);
  }

  function save(action: () => Promise<{ ok: boolean; error?: string }>, rollback: () => void, message: string) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        rollback();
        toast({ message: result.error ?? "That did not save.", tone: "error" });
        return;
      }
      toast({ message });
      router.refresh();
    });
  }

  function toggleAll(next: boolean) {
    setEnabled(next);
    save(
      () => setAutoCategorize(next),
      () => setEnabled(!next),
      next ? "Trusted merchants are filed automatically" : "Automatic filing is off",
    );
  }

  function patch(m: AutoMerchant, change: Partial<AutoMerchant>, message: string) {
    const before = merchants;
    setMerchants((list) => list.map((x) => (x.ruleId === m.ruleId ? { ...x, ...change } : x)));
    save(
      () => updateMerchantRule(m.ruleId, { categoryId: change.categoryId, autoEnabled: change.autoEnabled }),
      () => setMerchants(before),
      message,
    );
  }

  function remove(m: AutoMerchant) {
    if (!confirm(`Forget ${m.name}? It will no longer be suggested or filed automatically. Transactions already filed keep their category.`)) return;
    const before = merchants;
    setOpenId(null);
    setMerchants((list) => list.filter((x) => x.ruleId !== m.ruleId));
    save(() => forgetMerchantRule(m.ruleId), () => setMerchants(before), `${m.name} forgotten`);
  }

  const open = merchants.find((m) => m.ruleId === openId) ?? null;

  return (
    <div>
      <p className="text-sm leading-relaxed text-ink-2">
        When you file a merchant in the same category {AUTO_THRESHOLD} times in a row, new transactions from it are filed automatically and
        skip review. They are marked <AutoBadge className="mx-0.5 align-[1px]" /> so you can spot and correct mistakes; a correction
        stops the merchant being automatic until you have confirmed the new category {AUTO_THRESHOLD} times.
      </p>

      <div className="mt-6 flex items-center justify-between gap-4 rounded-lg bg-surface px-4 py-4 ring-1 ring-inset ring-line">
        <div className="min-w-0">
          <p id="auto-all-label" className="text-sm font-medium">
            File trusted merchants automatically
          </p>
          <p className="mt-0.5 text-xs text-ink-3">
            {settings.spaceKind === "shared"
              ? "For the shared space, for both of you."
              : "For your own accounts. The shared space has its own setting."}
          </p>
        </div>
        <Switch checked={enabled} onChange={toggleAll} disabled={pending} labelledBy="auto-all-label" />
      </div>

      <section className="mt-10" aria-labelledby="auto-merchants-heading">
        <div className="flex items-baseline justify-between">
          <SectionLabel id="auto-merchants-heading">Trusted merchants</SectionLabel>
          {merchants.length > 0 ? <p className="text-xs text-ink-3">{merchants.length}</p> : null}
        </div>
        {!enabled && merchants.length > 0 ? (
          <p className="mt-3 text-xs text-ink-2">Automatic filing is off, so these merchants are only suggested in review.</p>
        ) : null}
        {merchants.length === 0 ? (
          <p className="mt-4 border-y border-line py-8 text-center text-sm text-ink-2">
            No trusted merchants yet. A merchant appears here once you have filed it in the same category {AUTO_THRESHOLD} times.
          </p>
        ) : (
          <ul className={cn("mt-2 divide-y divide-line", !enabled && "opacity-60")}>
            {merchants.map((m) => {
              const c = byId.get(m.categoryId);
              return (
                <li key={m.ruleId}>
                  <button
                    type="button"
                    onClick={() => setOpenId(m.ruleId)}
                    className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3.5 rounded-md px-2 py-3 text-left transition-colors hover:bg-sunken/50 active:bg-sunken"
                  >
                    {c ? (
                      <CategoryMark icon={c.icon} color={c.color} />
                    ) : (
                      <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-md bg-sunken text-ink-3">
                        <CircleDashed className="size-4" strokeWidth={1.75} />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{m.name}</span>
                      <span className="mt-0.5 block truncate text-xs text-ink-2">
                        {c ? `${c.name}${c.archived ? " (archived)" : ""}` : "Category removed"}
                      </span>
                      <span className="tnum mt-0.5 block text-2xs text-ink-3">{timesLabel(m)}</span>
                    </span>
                    {m.autoEnabled ? <AutoBadge /> : <span className="shrink-0 text-2xs text-ink-3">Auto off</span>}
                    <ChevronRight className="size-4 shrink-0 text-ink-3" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <MerchantSheet
        merchant={open}
        categories={categories}
        byId={byId}
        pending={pending}
        onClose={() => setOpenId(null)}
        onPatch={patch}
        onRemove={remove}
      />
    </div>
  );
}

function timesLabel(m: AutoMerchant): string {
  const chosen = `Chosen ${m.confirmations} times`;
  return m.autoFiledCount > 0 ? `${chosen} · ${m.autoFiledCount} auto-filed` : chosen;
}

function MerchantSheet({
  merchant,
  categories,
  byId,
  pending,
  onClose,
  onPatch,
  onRemove,
}: {
  merchant: AutoMerchant | null;
  categories: Category[];
  byId: Map<string, Category>;
  pending: boolean;
  onClose: () => void;
  onPatch: (m: AutoMerchant, change: Partial<AutoMerchant>, message: string) => void;
  onRemove: (m: AutoMerchant) => void;
}) {
  // Keep showing the last merchant while the sheet animates closed.
  const [shown, setShown] = useState(merchant);
  if (merchant && merchant !== shown) setShown(merchant);
  if (!shown) return null;
  const m = shown;
  const active = categories.filter((c) => !c.archived);
  const current = byId.get(m.categoryId);

  return (
    <Sheet open={merchant !== null} onOpenChange={(o) => !o && onClose()} title={m.name} description={timesLabel(m)}>
      <div className="space-y-7 pt-2">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p id="auto-one-label" className="text-sm font-medium">
              File automatically
            </p>
            <p className="mt-0.5 text-xs text-ink-3">
              {m.autoEnabled
                ? `New ${m.name} transactions skip review.`
                : `New ${m.name} transactions wait in review, with ${current?.name ?? "the category"} suggested.`}
            </p>
          </div>
          <Switch
            checked={m.autoEnabled}
            disabled={pending}
            labelledBy="auto-one-label"
            onChange={(next) =>
              onPatch(m, { autoEnabled: next }, next ? `${m.name} is filed automatically` : `${m.name} will be suggested, not filed`)
            }
          />
        </div>

        <div>
          <SectionLabel>Category</SectionLabel>
          <p className="mt-1 text-xs text-ink-3">Changes where new transactions go. Ones already filed keep their category.</p>
          <div className="mt-3">
            <CategoryGrid
              categories={active}
              selectedId={m.categoryId}
              disabled={pending}
              onSelect={(c) => c.id !== m.categoryId && onPatch(m, { categoryId: c.id }, `${m.name} now goes to ${c.name}`)}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Button variant="danger" block onClick={() => onRemove(m)} disabled={pending}>
            Forget this merchant
          </Button>
          <Button variant="secondary" block onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

function Switch({
  checked,
  onChange,
  disabled,
  labelledBy,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  labelledBy: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-150 disabled:opacity-60",
        // A 44 px tap target around the 28 px track.
        "before:absolute before:-inset-2 before:content-['']",
        checked ? "bg-accent" : "bg-line-strong",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "inline-block size-5 rounded-full bg-surface shadow-sm transition-transform duration-150",
          checked ? "translate-x-6" : "translate-x-1",
        )}
      />
    </button>
  );
}
