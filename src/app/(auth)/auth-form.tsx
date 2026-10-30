"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/field";
import type { AuthState } from "./actions";

export function AuthForm({
  action,
  mode,
  next,
}: {
  action: (state: AuthState, formData: FormData) => Promise<AuthState>;
  mode: "login" | "signup" | "reset";
  next?: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" inputMode="email" required autoFocus />
      </div>
      {mode !== "reset" ? (
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <Label htmlFor="password">Password</Label>
            {mode === "login" ? (
              <Link href="/auth/reset" className="text-xs text-ink-2 underline-offset-4 hover:underline">
                Forgot?
              </Link>
            ) : null}
          </div>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            minLength={mode === "signup" ? 10 : undefined}
            required
          />
          {mode === "signup" ? <p className="text-xs text-ink-3">At least 10 characters.</p> : null}
        </div>
      ) : null}
      <FieldError>{state?.error}</FieldError>
      {state?.message ? (
        <p role="status" className="rounded-md bg-accent-soft px-3.5 py-3 text-sm text-ink">
          {state.message}
        </p>
      ) : null}
      <Button type="submit" size="lg" block disabled={pending}>
        {pending ? "One moment…" : mode === "login" ? "Sign in" : mode === "signup" ? "Create account" : "Send reset link"}
      </Button>
    </form>
  );
}
