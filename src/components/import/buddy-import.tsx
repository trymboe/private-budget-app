"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { FileUp } from "lucide-react";
import { previewBuddyImport, runBuddyImport, type ImportOptions, type ImportPreview } from "@/app/actions/import";
import { Amount, Money } from "@/components/ui/amount";
import { Button } from "@/components/ui/button";
import { FieldError, SectionLabel } from "@/components/ui/field";
import type { Category } from "@/lib/data/types";
import { formatShortDate } from "@/lib/dates";

type Decision = ImportPreview["categories"][number]["decision"];

const SKIP_TEXT: Record<string, (n: string, bankStart: string | null) => string> = {
  after_cutoff: (n, start) => `${n} from ${start ? formatShortDate(start) : "the day your bank data starts"} onwards are left out, because your bank already has them.`,
  already_imported: (n) => `${n} were already imported earlier, so they are left out.`,
  zero_amount: (n) => `${n} have an amount of 0, so they are left out.`,
  other_currency: (n) => `${n} are in another currency, so they are left out.`,
};

const rows = (n: number) => `${n.toLocaleString("nb-NO")} transaction${n === 1 ? "" : "s"}`;

/** Read the file as text, whatever encoding the exporting app used. */
async function readText(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

function encode(d: Decision): string {
  return d.action === "existing" ? `existing:${d.categoryId}` : `create:${d.kind}`;
}

function decode(value: string): Decision {
  const [action, rest] = value.split(":");
  return action === "existing" ? { action: "existing", categoryId: rest } : { action: "create", kind: rest as "expense" | "income" };
}

export function BuddyImport({ categories, space }: { categories: Category[]; space: { id: string; label: string; shared: boolean } }) {
  const router = useRouter();
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [range, setRange] = useState<ImportOptions["range"]>("bank");
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<{ imported: number; categoriesCreated: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function check(text: string, nextRange: ImportOptions["range"]) {
    setError(null);
    startTransition(async () => {
      const r = await previewBuddyImport(text, { spaceId: space.id, range: nextRange, decisions });
      if (!r.ok) {
        setPreview(null);
        return setError(r.error);
      }
      setPreview(r);
    });
  }

  async function choose(f: File | undefined) {
    if (!f) return;
    setResult(null);
    setDecisions({});
    const text = await readText(f);
    setFile({ name: f.name, text });
    check(text, range);
  }

  function run() {
    if (!file || !preview) return;
    if (!confirm(`Import ${rows(preview.toImport)} from ${file.name}?`)) return;
    setError(null);
    startTransition(async () => {
      const r = await runBuddyImport(file.text, { spaceId: space.id, range, decisions });
      if (!r.ok) return setError(r.error);
      setResult({ imported: r.imported, categoriesCreated: r.categoriesCreated });
      setPreview(null);
      setFile(null);
      router.refresh();
    });
  }

  if (result) {
    return (
      <div className="space-y-4">
        <p className="font-display text-lg">Imported {rows(result.imported)}.</p>
        <p className="text-sm text-ink-2">
          {result.categoriesCreated > 0
            ? `${result.categoriesCreated} new categor${result.categoriesCreated === 1 ? "y was" : "ies were"} created. `
            : ""}
          They are in the account “Buddy history”. To undo the whole import, remove that account under Banks &amp; accounts.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href="/transactions">See transactions</Link>
          </Button>
          <Button variant="secondary" asChild>
            <Link href="/budget/categories">Categories</Link>
          </Button>
        </div>
      </div>
    );
  }

  const expense = categories.filter((c) => c.kind === "expense");
  const income = categories.filter((c) => c.kind === "income");
  const nameTaken = (key: string) => categories.some((c) => c.name.trim().toLocaleLowerCase("nb-NO") === key);

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <p className="text-sm text-ink-2">
          Export your data from Buddy and choose the file here. You will see exactly what will be imported before anything is saved.
          Importing the same file twice never creates duplicates.
        </p>
        <p className="text-sm text-ink-2">
          Importing into <strong>{space.label}</strong>
          {space.shared ? ", which you share" : ", which only you can see"}. To import into another space, switch space first.
        </p>
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md bg-surface px-4 py-4 text-sm font-medium ring-1 ring-inset ring-line-strong hover:bg-sunken/60">
          <FileUp className="size-4" aria-hidden />
          {file ? file.name : "Choose export file"}
          <input
            type="file"
            accept=".csv,.txt,.tsv,text/csv,text/plain"
            disabled={pending}
            className="sr-only"
            onChange={(e) => {
              void choose(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
        {pending && !preview ? <p className="text-xs text-ink-3">Reading the file…</p> : null}
        <FieldError>{error}</FieldError>
      </section>

      {preview && file ? (
        <>
          <section className="space-y-3">
            <SectionLabel>What will be imported</SectionLabel>
            <p className="text-sm">
              <strong>{rows(preview.toImport)}</strong> of {preview.rowsInFile.toLocaleString("nb-NO")} rows in the file
              {preview.firstDate && preview.lastDate
                ? `, from ${formatShortDate(preview.firstDate)} to ${formatShortDate(preview.lastDate)}`
                : ""}
              .
            </p>
            <p className="text-sm text-ink-2">
              Spending <Money minor={preview.totalOutMinor} decimals="auto" /> · income <Money minor={preview.totalInMinor} decimals="auto" />
            </p>
            {preview.skipped.map((s) => (
              <p key={s.reason} className="text-sm text-ink-2">
                {SKIP_TEXT[s.reason]?.(rows(s.count), preview.bankStartsOn)}
              </p>
            ))}
            {preview.uncategorized > 0 ? (
              <p className="text-sm text-ink-2">
                {rows(preview.uncategorized)} have no category in Buddy. They go to your review queue so you can categorise them.
              </p>
            ) : null}
            {preview.bankStartsOn ? (
              <label className="flex cursor-pointer items-start gap-3 pt-1">
                <input
                  type="checkbox"
                  checked={range === "bank"}
                  onChange={(e) => {
                    const next = e.target.checked ? "bank" : "all";
                    setRange(next);
                    check(file.text, next);
                  }}
                  className="mt-0.5 size-5 accent-[var(--ink)]"
                />
                <span>
                  <span className="block text-sm font-medium">Stop where my bank data starts</span>
                  <span className="block text-xs text-ink-2">
                    Your bank transactions start on {formatShortDate(preview.bankStartsOn)}. Importing Buddy rows from that day on would count
                    the same purchases twice.
                  </span>
                </span>
              </label>
            ) : null}
          </section>

          {preview.categories.length > 0 ? (
            <section>
              <SectionLabel>Categories</SectionLabel>
              <p className="mt-2 text-xs text-ink-3">
                Buddy categories with the same name as one of yours go into that category. The rest are created. You can change any of them.
              </p>
              <ul className="mt-3 divide-y divide-line">
                {preview.categories.map((c) => {
                  const decision = decisions[c.key] ?? c.suggestion;
                  const taken = nameTaken(c.key);
                  return (
                    <li key={c.key} className="space-y-2 py-3">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0 truncate text-sm font-medium">{c.name}</span>
                        <span className="shrink-0 text-xs text-ink-3">
                          {rows(c.rowCount)} · <Money minor={c.spentMinor - c.receivedMinor} decimals="never" />
                        </span>
                      </div>
                      <select
                        aria-label={`Where ${c.name} goes`}
                        value={encode(decision)}
                        onChange={(e) => setDecisions({ ...decisions, [c.key]: decode(e.target.value) })}
                        className="h-11 w-full rounded-md bg-surface px-3 text-sm ring-1 ring-inset ring-line-strong"
                      >
                        {!taken ? (
                          <optgroup label="Create new">
                            <option value="create:expense">New spending category “{c.name}”</option>
                            <option value="create:income">New income category “{c.name}”</option>
                          </optgroup>
                        ) : null}
                        <optgroup label="Your spending categories">
                          {expense.map((x) => (
                            <option key={x.id} value={`existing:${x.id}`}>
                              {x.name}
                            </option>
                          ))}
                        </optgroup>
                        <optgroup label="Your income categories">
                          {income.map((x) => (
                            <option key={x.id} value={`existing:${x.id}`}>
                              {x.name}
                            </option>
                          ))}
                        </optgroup>
                      </select>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {preview.sample.length > 0 ? (
            <section>
              <SectionLabel>First rows, as they will appear</SectionLabel>
              <ul className="mt-2 divide-y divide-line">
                {preview.sample.map((s, i) => (
                  <li key={i} className="flex items-baseline justify-between gap-3 py-2.5 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate">{s.description ?? s.category ?? "No description"}</span>
                      <span className="block text-xs text-ink-3">
                        {formatShortDate(s.date)}
                        {s.category ? ` · ${s.category}` : ""}
                      </span>
                    </span>
                    <Amount minor={s.amountMinor} decimals="auto" className="shrink-0" />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="space-y-3">
            <Button block size="lg" disabled={pending || preview.toImport === 0} onClick={run}>
              {pending ? "Working…" : preview.toImport === 0 ? "Nothing new to import" : `Import ${rows(preview.toImport)}`}
            </Button>
            <p className="text-center text-2xs text-ink-3">
              Everything goes into a separate account, “Buddy history”. Removing that account undoes the import.
            </p>
          </section>
        </>
      ) : null}
    </div>
  );
}
