import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { signOut } from "@/app/(auth)/actions";
import { Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { getConnections, getProfile } from "@/lib/data/queries";
import { APP_NAME } from "@/lib/brand";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const [profile, connections] = await Promise.all([getProfile(), getConnections()]);
  const real = connections.filter((c) => c.id !== "disconnected");
  const needsAttention = real.some((c) => c.status === "expired");

  const rows = [
    {
      href: "/settings/accounts",
      label: "Banks & accounts",
      detail: real.length === 0 ? "Not connected" : needsAttention ? "Needs renewing" : `${real.length} connected`,
      attention: needsAttention,
    },
    { href: "/budget/categories", label: "Categories", detail: "Names, colours, order" },
    { href: "/welcome", label: "Setup guide", detail: profile.onboarding.completed ? "Completed" : "In progress" },
    { href: "/settings/password", label: "Change password", detail: "" },
  ];

  return (
    <Page>
      <PageHeader title="Settings" />
      <ul className="divide-y divide-line border-y border-line">
        {rows.map((r) => (
          <li key={r.href}>
            <Link href={r.href} className="-mx-2 flex items-center justify-between gap-4 rounded-md px-2 py-4 hover:bg-sunken/50">
              <span className="text-sm font-medium">{r.label}</span>
              <span className="flex items-center gap-2 text-xs text-ink-3">
                <span className={r.attention ? "text-ochre" : undefined}>{r.detail}</span>
                <ChevronRight className="size-4" aria-hidden />
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <div className="mt-10 space-y-1 text-xs text-ink-3">
        <p>Signed in as {profile.email}</p>
        <p>Currency NOK · Time zone {profile.timeZone}</p>
      </div>
      <form action={signOut} className="mt-6">
        <Button type="submit" variant="secondary">
          Sign out
        </Button>
      </form>
      <p className="mt-12 text-2xs text-ink-3">{APP_NAME} · read-only bank access through Enable Banking (PSD2).</p>
    </Page>
  );
}
