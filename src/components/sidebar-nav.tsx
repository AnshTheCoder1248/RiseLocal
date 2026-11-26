"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bookmark, FileText, Plus, Search, ShieldCheck, UserRound } from "lucide-react";
import { cn } from "cn";

const ICONS = { search: Search, bookmark: Bookmark, file: FileText, plus: Plus, user: UserRound, review: ShieldCheck };

export type NavItem = { href: string; label: string; icon: keyof typeof ICONS };

export function SidebarNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Your actions" className="flex gap-1 overflow-x-auto px-4 py-2 md:flex-col md:px-3 md:py-6">
      {items.map(({ href, label, icon }) => {
        const Icon = ICONS[icon];
        const active = pathname === href || pathname.startsWith(`${href}/`);
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
          </Link>
        );
      })}
    </nav>
  );
}
