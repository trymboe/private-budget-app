"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Plus } from "lucide-react";
import {
  createCategory,
  mergeCategory,
  reorderCategories,
  setCategoryArchived,
  updateCategory,
} from "@/app/actions/budget";
import { CATEGORY_COLORS, CATEGORY_ICONS, CategoryIcon, CategoryMark, categoryColorVar } from "@/components/category-icon";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label, SectionLabel } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import type { Category } from "@/lib/data/types";
import { cn } from "@/lib/utils";

type Draft = { name: string; kind: "expense" | "income"; icon: string; color: string; isFixed: boolean };

export function CategoryManager({ categories }: { categories: Category[] }) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState<Category | "new" | null>(null);
  const [pending, startTransition] = useTransition();
  const active = categories.filter((c) => !c.archived);
  const archived = categories.filter((c) => c.archived);

  function move(kind: Category["kind"], index: number, delta: number) {
    const list = active.filter((c) => c.kind === kind);
    const target = index + delta;
    if (target < 0 || target >= list.length) return;
    const reordered = [...list];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    const others = active.filter((c) => c.kind !== kind);
    const ordered = kind === "expense" ? [...reordered, ...others] : [...others, ...reordered];
    startTransition(async () => {
      const result = await reorderCategories(ordered.map((c) => c.id));
      if (!result.ok) toast({ message: result.error, tone: "error" });
      router.refresh();
    });
  }

  const section = (kind: Category["kind"], title: string) => {
    const list = active.filter((c) => c.kind === kind);
    return (
      <section className="mt-10 first-of-type:mt-0">
        <SectionLabel>{title}</SectionLabel>
        <ul className="mt-2 divide-y divide-line">
          {list.map((c, i) => (
            <li key={c.id} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setEditing(c)}
                className="-ml-2 flex min-w-0 flex-1 items-center gap-3.5 rounded-md px-2 py-3 text-left hover:bg-sunken/50"
              >
                <CategoryMark icon={c.icon} color={c.color} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{c.name}</span>
                  {c.isFixed ? <span className="text-2xs text-ink-3">Fixed cost</span> : null}
                </span>
              </button>
              <div className="flex shrink-0">
                <button
                  type="button"
                  disabled={i === 0 || pending}
                  onClick={() => move(kind, i, -1)}
                  aria-label={`Move ${c.name} up`}
                  className="grid size-10 place-items-center rounded-full text-ink-3 hover:bg-sunken hover:text-ink disabled:opacity-30"
                >
                  <ArrowUp className="size-4" aria-hidden />
                </button>
                <button
                  type="button"
                  disabled={i === list.length - 1 || pending}
                  onClick={() => move(kind, i, 1)}
                  aria-label={`Move ${c.name} down`}
                  className="grid size-10 place-items-center rounded-full text-ink-3 hover:bg-sunken hover:text-ink disabled:opacity-30"
                >
                  <ArrowDown className="size-4" aria-hidden />
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    );
  };

  return (
    <>
      <Button variant="secondary" block onClick={() => setEditing("new")} className="mb-8">
        <Plus className="size-4" aria-hidden /> New category
      </Button>
      {section("expense", "Spending")}
      {section("income", "Income")}
      {archived.length > 0 ? (
        <section className="mt-10">
          <SectionLabel>Archived</SectionLabel>
          <ul className="mt-2 divide-y divide-line">
            {archived.map((c) => (
              <li key={c.id} className="flex items-center gap-3.5 py-3 text-ink-2">
                <CategoryMark icon={c.icon} color={c.color} />
                <span className="flex-1 text-sm">{c.name}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const r = await setCategoryArchived(c.id, false);
                      toast(r.ok ? { message: `${c.name} restored` } : { message: r.error, tone: "error" });
                      router.refresh();
                    })
                  }
                >
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Sheet
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title={editing === "new" ? "New category" : "Edit category"}
      >
        {editing ? (
          <CategoryForm
            key={editing === "new" ? "new" : editing.id}
            category={editing === "new" ? null : editing}
            others={active.filter((c) => editing === "new" || (c.id !== editing.id && c.kind === editing.kind))}
            onDone={(message) => {
              setEditing(null);
              toast({ message });
              router.refresh();
            }}
          />
        ) : null}
      </Sheet>
    </>
  );
}

function CategoryForm({
  category,
  others,
  onDone,
}: {
  category: Category | null;
  others: Category[];
  onDone: (message: string) => void;
}) {
  const [draft, setDraft] = useState<Draft>(
    category
      ? { name: category.name, kind: category.kind, icon: category.icon, color: category.color, isFixed: category.isFixed }
      : { name: "", kind: "expense", icon: "circle", color: "stone", isFixed: false },
  );
  const [mergeTarget, setMergeTarget] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = category ? await updateCategory(category.id, draft) : await createCategory(draft);
      if (!result.ok) return setError(result.error);
      onDone(category ? "Category saved" : `${draft.name} created`);
    });
  }

  return (
    <form onSubmit={submit} className="space-y-6 pt-2">
      <div className="space-y-2">
        <Label htmlFor="cat-name">Name</Label>
        <Input id="cat-name" value={draft.name} maxLength={60} required onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
      </div>

      {!category ? (
        <div className="grid grid-cols-2 gap-1 rounded-md bg-sunken p-1" role="radiogroup" aria-label="Type">
          {(["expense", "income"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={draft.kind === k}
              onClick={() => setDraft({ ...draft, kind: k })}
              className={cn("h-10 rounded-[7px] text-xs font-medium", draft.kind === k ? "bg-surface shadow-sm" : "text-ink-2")}
            >
              {k === "expense" ? "Spending" : "Income"}
            </button>
          ))}
        </div>
      ) : null}

      <fieldset>
        <legend className="text-xs font-medium text-ink-2">Colour</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {CATEGORY_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => setDraft({ ...draft, color })}
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
          {Object.keys(CATEGORY_ICONS).map((icon) => (
            <button
              key={icon}
              type="button"
              onClick={() => setDraft({ ...draft, icon })}
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

      {draft.kind === "expense" ? (
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={draft.isFixed}
            onChange={(e) => setDraft({ ...draft, isFixed: e.target.checked })}
            className="mt-0.5 size-5 accent-[var(--ink)]"
          />
          <span>
            <span className="block text-sm font-medium">Fixed cost</span>
            <span className="block text-xs text-ink-2">Rent, insurance, subscriptions. Left out of day-to-day pace, since it arrives in lumps.</span>
          </span>
        </label>
      ) : null}

      <FieldError>{error}</FieldError>
      <Button type="submit" block size="lg" disabled={pending || !draft.name.trim()}>
        {category ? "Save" : "Create category"}
      </Button>

      {category ? (
        <div className="space-y-4 border-t border-line pt-6">
          <div className="space-y-2">
            <Label htmlFor="merge">Merge into another category</Label>
            <p className="text-xs text-ink-3">
              All past and future transactions and budgets move to the chosen category. Totals for earlier months stay the same.
            </p>
            <div className="flex gap-2">
              <select
                id="merge"
                value={mergeTarget}
                onChange={(e) => setMergeTarget(e.target.value)}
                className="h-11 min-w-0 flex-1 rounded-md bg-surface px-3 text-sm ring-1 ring-inset ring-line-strong"
              >
                <option value="">Choose…</option>
                {others.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <Button
                variant="secondary"
                disabled={!mergeTarget || pending}
                onClick={() =>
                  startTransition(async () => {
                    const target = others.find((c) => c.id === mergeTarget);
                    if (!target || !confirm(`Merge ${category.name} into ${target.name}? This cannot be undone.`)) return;
                    const r = await mergeCategory(category.id, mergeTarget);
                    if (!r.ok) return setError(r.error);
                    onDone(`Merged into ${target.name}`);
                  })
                }
              >
                Merge
              </Button>
            </div>
          </div>
          <Button
            variant="danger"
            block
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const r = await setCategoryArchived(category.id, true);
                if (!r.ok) return setError(r.error);
                onDone(`${category.name} archived`);
              })
            }
          >
            Archive category
          </Button>
          <p className="text-center text-2xs text-ink-3">Archived categories keep their history and can be restored.</p>
        </div>
      ) : null}
    </form>
  );
}
