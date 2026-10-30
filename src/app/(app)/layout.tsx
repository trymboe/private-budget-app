import { BottomNav, SideNav } from "@/components/app-nav";
import { ToastProvider } from "@/components/ui/toast";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const supabase = await createClient();
  const { count } = await supabase
    .from("transactions")
    .select("id, accounts!inner(is_synced)", { count: "exact", head: true })
    .eq("needs_review", true)
    .is("removed_at", null)
    .eq("accounts.is_synced", true);

  return (
    <ToastProvider>
      <div className="flex min-h-dvh">
        <SideNav reviewCount={count ?? 0} email={user.email} />
        <div className="min-w-0 flex-1 pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:pb-0">{children}</div>
      </div>
      <BottomNav reviewCount={count ?? 0} />
    </ToastProvider>
  );
}
