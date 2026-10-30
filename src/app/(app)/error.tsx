"use client";

import { Button } from "@/components/ui/button";

export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-[70dvh] max-w-sm flex-col justify-center px-6 text-center">
      <h1 className="font-display text-2xl leading-none">Something went wrong.</h1>
      <p className="mt-3 text-sm text-ink-2">Your data is safe. This page could not load just now; it is usually a brief connection hiccup.</p>
      <Button className="mx-auto mt-8" onClick={reset}>
        Try again
      </Button>
    </main>
  );
}
