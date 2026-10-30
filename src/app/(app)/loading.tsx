export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-2xl px-5 pt-[max(1.5rem,env(safe-area-inset-top))] sm:px-8 lg:pt-12" aria-busy="true" aria-label="Loading">
      <div className="h-3 w-32 animate-pulse rounded bg-sunken" />
      <div className="mt-8 h-14 w-56 animate-pulse rounded bg-sunken" />
      <div className="mt-4 h-3 w-40 animate-pulse rounded bg-sunken" />
      <div className="mt-8 h-2 w-full animate-pulse rounded-full bg-sunken" />
      <div className="mt-14 space-y-5">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex items-center gap-3.5">
            <div className="size-8 animate-pulse rounded-md bg-sunken" />
            <div className="h-3 flex-1 animate-pulse rounded bg-sunken" />
            <div className="h-3 w-16 animate-pulse rounded bg-sunken" />
          </div>
        ))}
      </div>
    </main>
  );
}
