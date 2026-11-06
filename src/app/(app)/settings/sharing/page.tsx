import type { Metadata } from "next";
import Link from "next/link";
import { Page, PageHeader } from "@/components/page";
import { getProfile } from "@/lib/data/queries";
import { getSharedSpace, partnerOf } from "@/lib/spaces";
import { InviteForm, NameForm } from "./forms";

export const metadata: Metadata = { title: "Sharing" };

export default async function SharingPage() {
  const [profile, shared] = await Promise.all([getProfile(), getSharedSpace()]);
  const partner = partnerOf(shared);

  return (
    <Page>
      <PageHeader title="Sharing" back={{ href: "/settings", label: "Settings" }} />

      <section className="space-y-3 text-sm text-ink-2">
        <p>
          Share {partner ? `with ${partner.name ?? "your partner"}` : "with a partner"} without giving up privacy. You each have your own login
          and your own private accounts, and a <strong className="font-medium text-ink">Shared</strong> space for the money you handle
          together, such as a joint account.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Private accounts, with their transactions, categories and budget, are only visible to the person who connected them.</li>
          <li>Accounts you put in Shared are visible to both of you. Either of you can categorise them, and they have their own budget.</li>
          <li>
            You choose per account in{" "}
            <Link href="/settings/accounts" className="font-medium text-ink underline-offset-4 hover:underline">
              Banks &amp; accounts
            </Link>
            . Bank logins stay personal: each of you connects your own bank with your own BankID.
          </li>
        </ul>
      </section>

      <section className="mt-10 border-t border-line pt-6">
        <h2 className="text-base font-semibold">Your name</h2>
        <p className="mt-1 mb-4 text-xs text-ink-3">Shown to your partner next to the accounts you share.</p>
        <NameForm initial={profile.displayName ?? ""} />
      </section>

      <section className="mt-10 border-t border-line pt-6">
        <h2 className="text-base font-semibold">{partner ? `Shared with ${partner.name ?? "your partner"}` : "Invite your partner"}</h2>
        {partner ? (
          <p className="mt-1 mb-4 text-sm text-ink-2">
            You share the Shared space. If {partner.name ?? "they"} has not opened the invitation yet, you can make a new link below.
          </p>
        ) : (
          <p className="mt-1 mb-4 text-sm text-ink-2">
            This creates an account for her and gives you a one-time link to send her. She opens it, chooses a password and connects her own
            bank.
          </p>
        )}
        <InviteForm partnerName={partner?.name ?? null} />
      </section>
    </Page>
  );
}
