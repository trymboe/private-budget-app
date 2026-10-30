import type { Metadata } from "next";
import Link from "next/link";
import { requestPasswordReset } from "../../actions";
import { AuthForm } from "../../auth-form";

export const metadata: Metadata = { title: "Reset password" };

export default function ResetPage() {
  return (
    <>
      <h1 className="font-display text-2xl leading-none tracking-tight">Reset your password.</h1>
      <p className="mt-3 text-sm text-ink-2">We will email you a link to choose a new one.</p>
      <div className="mt-10">
        <AuthForm action={requestPasswordReset} mode="reset" />
      </div>
      <p className="mt-8 text-sm text-ink-2">
        <Link href="/login" className="font-medium text-ink underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      </p>
    </>
  );
}
