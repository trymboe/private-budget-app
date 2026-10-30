import type { Metadata } from "next";
import Link from "next/link";
import { signUp } from "../actions";
import { AuthForm } from "../auth-form";

export const metadata: Metadata = { title: "Create account" };

export default function SignupPage() {
  return (
    <>
      <h1 className="font-display text-2xl leading-none tracking-tight">A calmer month starts here.</h1>
      <p className="mt-3 text-sm text-ink-2">Create an account. Connecting your bank comes next, and it is optional.</p>
      <div className="mt-10">
        <AuthForm action={signUp} mode="signup" />
      </div>
      <p className="mt-8 text-sm text-ink-2">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-ink underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
