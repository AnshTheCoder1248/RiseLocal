import { connection } from "next/server";
import { Suspense } from "react";
import { getCurrentUser } from "@/lib/auth/session";
import type { Role } from "@/generated/prisma/client";
import { SidebarNav, type NavItem } from "./sidebar-nav";

const PROFILE: NavItem = { href: "/profile", label: "Profile", icon: "user" };

/** The actions each role can take, shown in the left sidebar once signed in. */
const NAV: Record<Role, NavItem[]> = {
  STUDENT: [
    { href: "/jobs", label: "Browse jobs", icon: "search" },
    { href: "/saved", label: "Saved jobs", icon: "bookmark" },
    { href: "/resume", label: "My resume", icon: "file" },
    PROFILE,
  ],
  COMMUNITY: [
    { href: "/jobs", label: "Browse jobs", icon: "search" },
    { href: "/post", label: "Post a gig", icon: "plus" },
    PROFILE,
  ],
  EMPLOYER: [{ href: "/jobs", label: "Browse jobs", icon: "search" }, PROFILE],
  ADMIN: [
    { href: "/jobs", label: "Browse jobs", icon: "search" },
    { href: "/review", label: "Review jobs", icon: "review" },
    PROFILE,
  ],
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
  return (
    <aside className="border-b bg-sidebar text-sidebar-foreground md:sticky md:top-0 md:h-[calc(100svh-3.5rem)] md:w-56 md:shrink-0 md:border-r md:border-b-0">
      <SidebarNav items={NAV[user.role]} />
    </aside>
  );
}
