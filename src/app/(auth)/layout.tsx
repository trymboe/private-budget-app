import { Logo } from "@/components/logo";
import { APP_NAME } from "@/lib/brand";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col px-6 pt-[max(4rem,env(safe-area-inset-top))] pb-10">
      <Logo className="text-ink" />
      <div className="mt-14 flex-1">{children}</div>
      <p className="mt-10 text-xs leading-relaxed text-ink-3">
        Your bank login happens only at your bank. {APP_NAME} never sees your bank credentials.
      </p>
    </main>
  );
}
