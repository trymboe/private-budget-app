import { BottomNav, SideNav } from "@/components/app-nav";
import { SpaceSwitcher } from "@/components/space-switcher";
import { ToastProvider } from "@/components/ui/toast";
import { requireUser } from "@/lib/auth";
import { getActiveSpace, getSpaces, spaceLabel } from "@/lib/spaces";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [supabase, spaces, active] = await Promise.all([createClient(), getSpaces(), getActiveSpace()]);
  const { count } = await supabase
    .from("transactions")
    .select("id, accounts!inner(is_synced)", { count: "exact", head: true })
    .eq("space_id", active.id)
    .eq("needs_review", true)
    .is("removed_at", null)
    .eq("accounts.is_synced", true);

  const options = spaces.map((s) => ({ id: s.id, label: spaceLabel(s) }));
  const switcher = options.length > 1 ? <SpaceSwitcher options={options} activeId={active.id} /> : null;

  return (
    <ToastProvider>
      <div className="flex min-h-dvh">
        <SideNav reviewCount={count ?? 0} email={user.email} switcher={switcher} />
        <div className="min-w-0 flex-1 pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:pb-0">
          {switcher ? (
            <div className="mx-auto w-full max-w-2xl px-5 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-8 lg:hidden">{switcher}</div>
          ) : null}
          {children}
        </div>
      </div>
      <BottomNav reviewCount={count ?? 0} />
    </ToastProvider>
  );
}
