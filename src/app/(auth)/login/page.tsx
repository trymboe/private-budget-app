import type { Metadata } from "next";
import Link from "next/link";
import { signIn } from "../actions";
import { AuthForm } from "../auth-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <>
      <h1 className="font-display text-2xl leading-none tracking-tight">Welcome back.</h1>
      <p className="mt-3 text-sm text-ink-2">Sign in to see how this month is going.</p>
      {error ? (
        <p role="alert" className="mt-6 rounded-md bg-brick-soft px-3.5 py-3 text-sm text-ink">
          That link has expired or was already used. Sign in, or request a new one.
        </p>
      ) : null}
      <div className="mt-10">
        <AuthForm action={signIn} mode="login" next={next} />
      </div>
      <p className="mt-8 text-sm text-ink-2">
        New here?{" "}
        <Link href="/signup" className="font-medium text-ink underline-offset-4 hover:underline">
          Create an account
        </Link>
      </p>
    </>
  );
}
