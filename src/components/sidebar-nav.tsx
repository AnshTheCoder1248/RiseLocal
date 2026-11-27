"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Bookmark, FileText, Inbox, LayoutDashboard, Plus, Search, Send, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import { cn } from "cn";

const ICONS = { search: Search, bookmark: Bookmark, file: FileText, plus: Plus, user: UserRound, review: ShieldCheck, send: Send, bell: Bell, inbox: Inbox, dashboard: LayoutDashboard, sparkles: Sparkles };

/** `badge`: an optional count shown after the label (e.g. unread notifications). */
export type NavItem = { href: string; label: string; icon: keyof typeof ICONS; badge?: number; badgeLabel?: string };

export function SidebarNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  // The longest matching href wins, so /business/post highlights "Post a job", not "Dashboard".
  const current = items
    .map((i) => i.href)
    .filter((h) => pathname === h || pathname.startsWith(`${h}/`))
    .sort((a, b) => b.length - a.length)[0];
  return (
    <nav aria-label="Your actions" className="flex gap-1 overflow-x-auto px-4 py-2 md:flex-col md:px-3 md:py-6">
      {items.map(({ href, label, icon, badge, badgeLabel = "new" }) => {
        const Icon = ICONS[icon];
        const active = href === current;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
              active && "bg-sidebar-accent text-sidebar-accent-foreground",
            )}
          >
            <Icon className="size-4" aria-hidden />
            {label}
            {badge ? (
              <span className="ml-auto min-w-5 rounded-full bg-primary px-1.5 text-center text-xs font-semibold leading-5 text-primary-foreground">
                {badge > 99 ? "99+" : badge}
                <span className="sr-only"> {badgeLabel}</span>
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
