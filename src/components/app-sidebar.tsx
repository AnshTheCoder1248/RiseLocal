import { connection } from "next/server";
import { Suspense } from "react";
import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import type { Role } from "@/generated/prisma/client";
import { SidebarNav, type NavItem } from "./sidebar-nav";

const PROFILE: NavItem = { href: "/profile", label: "Profile", icon: "user" };

/** The actions each role can take, shown in the left sidebar once signed in. */
const NAV: Record<Role, NavItem[]> = {
  STUDENT: [
    { href: "/jobs", label: "Browse jobs", icon: "search" },
    { href: "/applications", label: "My applications", icon: "send" },
    { href: "/notifications", label: "Notifications", icon: "inbox" },
    { href: "/saved", label: "Saved jobs", icon: "bookmark" },
    { href: "/watchlist", label: "Watchlist", icon: "bell" },
    { href: "/resume", label: "My resume", icon: "file" },
    PROFILE,
  ],
  COMMUNITY: [
    { href: "/jobs", label: "Browse jobs", icon: "search" },
    { href: "/post", label: "Post a gig", icon: "plus" },
    PROFILE,
  ],
  // Businesses manage their own postings rather than browse: /jobs redirects them to /business.
  EMPLOYER: [
    { href: "/business", label: "Dashboard", icon: "dashboard" },
    { href: "/business/suggestions", label: "Scout suggestions", icon: "sparkles" },
    { href: "/business/post", label: "Post a job", icon: "plus" },
    PROFILE,
  ],
  // Admins moderate rather than browse: the board itself redirects them to /review.
  ADMIN: [{ href: "/review", label: "Review jobs", icon: "review" }, PROFILE],
};

export function AppSidebar() {
  // Reads the session, so it streams in; visitors get no sidebar at all.
  return (
    <Suspense fallback={null}>
      <Sidebar />
    </Suspense>
  );
}

async function Sidebar() {
  await connection();
  const user = await getCurrentUser();
  if (!user) return null;
  // Counts shown next to a tab: unread notifications for students, pending Scout suggestions for businesses.
  const [unread, suggestions] = await Promise.all([
    user.role === "STUDENT" ? db.notification.count({ where: { userId: user.id, readAt: null } }) : 0,
    user.role === "EMPLOYER" && user.orgId ? db.agentDraft.count({ where: { orgId: user.orgId, reviewState: "pending" } }) : 0,
  ]);
  const badges: Record<string, [number, string]> = { "/notifications": [unread, "unread"], "/business/suggestions": [suggestions, "pending"] };
  const items = NAV[user.role].map((i) => (badges[i.href]?.[0] ? { ...i, badge: badges[i.href][0], badgeLabel: badges[i.href][1] } : i));
  return (
    <aside className="border-b bg-sidebar text-sidebar-foreground md:sticky md:top-0 md:h-[calc(100svh-3.5rem)] md:w-56 md:shrink-0 md:border-r md:border-b-0">
      <SidebarNav items={items} />
    </aside>
  );
}
