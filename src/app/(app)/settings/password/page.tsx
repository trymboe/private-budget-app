import type { Metadata } from "next";
import { Page, PageHeader } from "@/components/page";
import { PasswordForm } from "./password-form";

export const metadata: Metadata = { title: "Change password" };

export default function PasswordPage() {
  return (
    <Page>
      <PageHeader title="Change password" back={{ href: "/settings", label: "Settings" }} />
      <PasswordForm />
    </Page>
  );
}
