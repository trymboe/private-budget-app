import type { Metadata } from "next";
import { Page, PageHeader } from "@/components/page";
import { PasswordForm } from "./password-form";

export const metadata: Metadata = { title: "Change password" };

export default async function PasswordPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const { welcome } = await searchParams;
  if (welcome) {
    // Arrived from an invitation: the account exists but has no password yet.
    return (
      <Page>
        <PageHeader title="Welcome! Choose a password." />
        <p className="-mt-4 mb-8 max-w-sm text-sm text-ink-2">
          You’ll use your email and this password to sign in. Next, connect your own bank and set up your budget.
        </p>
        <PasswordForm next="/welcome" />
      </Page>
    );
  }
  return (
    <Page>
      <PageHeader title="Change password" back={{ href: "/settings", label: "Settings" }} />
      <PasswordForm />
    </Page>
  );
}
