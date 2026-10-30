import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 text-center">
      <h1 className="font-display text-2xl leading-none">Not here.</h1>
      <p className="mt-3 text-sm text-ink-2">That page does not exist, or it belongs to someone else.</p>
      <Link href="/" className="mt-8 text-sm font-medium underline underline-offset-4">
        Back to this month
      </Link>
    </main>
  );
}
