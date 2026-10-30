"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChartNoAxesColumn, House, ListOrdered, Settings, WalletCards } from "lucide-react";
import { APP_NAME } from "@/lib/brand";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/", label: "Home", icon: House },
  { href: "/transactions", label: "Transactions", icon: ListOrdered },
  { href: "/insights", label: "Insights", icon: ChartNoAxesColumn },
  { href: "/budget", label: "Budget", icon: WalletCards },
] as const;

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" || pathname.startsWith("/review") : pathname.startsWith(href);
}

/** Bottom tab bar on phones. Four destinations, labels always visible. */
export function BottomNav({ reviewCount }: { reviewCount: number }) {
  const pathname = usePathname();
  if (pathname.startsWith("/review") || pathname.startsWith("/welcome")) return null;
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-paper/95 pb-safe backdrop-blur-md supports-[backdrop-filter]:bg-paper/85 lg:hidden"
    >
      <ul className="mx-auto grid max-w-lg grid-cols-4">
        {ITEMS.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-15 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors",
                  active ? "text-ink" : "text-ink-3 hover:text-ink-2",
                )}
              >
                <Icon className="size-[22px]" strokeWidth={active ? 2 : 1.6} aria-hidden />
                {label}
                {href === "/transactions" && reviewCount > 0 ? (
                  <span className="absolute top-2 left-[calc(50%+8px)] size-2 rounded-full bg-accent" aria-label={`${reviewCount} to review`} />
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Sidebar on large screens: the same four destinations plus settings. */
export function SideNav({ reviewCount, email }: { reviewCount: number; email: string | null }) {
  const pathname = usePathname();
  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-line px-4 py-8 lg:flex">
      <Link href="/" className="px-3 font-display text-xl tracking-tight">
        {APP_NAME}
      </Link>
      <nav aria-label="Main" className="mt-10">
        <ul className="space-y-0.5">
          {ITEMS.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-10 items-center gap-3 rounded-md px-3 text-sm transition-colors",
                    active ? "bg-sunken font-medium text-ink" : "text-ink-2 hover:bg-sunken/60 hover:text-ink",
                  )}
                >
                  <Icon className="size-[18px]" strokeWidth={active ? 2 : 1.6} aria-hidden />
                  <span className="flex-1">{label}</span>
                  {href === "/transactions" && reviewCount > 0 ? (
                    <span className="tnum rounded-full bg-accent px-1.5 text-[11px] leading-5 text-accent-ink">{reviewCount}</span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="mt-auto">
        <Link
          href="/settings"
          className={cn(
            "flex h-10 items-center gap-3 rounded-md px-3 text-sm transition-colors",
            pathname.startsWith("/settings") ? "bg-sunken font-medium text-ink" : "text-ink-2 hover:bg-sunken/60 hover:text-ink",
          )}
        >
          <Settings className="size-[18px]" strokeWidth={1.6} aria-hidden />
          Settings
        </Link>
        {email ? <p className="mt-3 truncate px-3 text-2xs text-ink-3">{email}</p> : null}
      </div>
    </aside>
  );
}
