import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import type { Metadata } from "next";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { describeNotification } from "@/lib/notification-text";
import { NotificationList } from "./notification-list";

export const metadata: Metadata = { title: "Notifications — RiseLocal" };

export default function NotificationsPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <Suspense
        fallback={
          <>
            <Skeleton className="h-9 w-56" />
            <div className="grid gap-2">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}</div>
          </>
        }
      >
        <Inbox />
      </Suspense>
    </main>
  );
}

/** "just now", "5 min ago", "3 hr ago", "yesterday", "Nov 24". */
function when(d: Date, now = Date.now()) {
  const mins = Math.floor((now - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  if (hrs < 48) return "yesterday";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

async function Inbox() {
  await connection();
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/notifications");

  const rows = await db.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 50 });
  const items = rows.map((n) => ({ id: n.id, read: n.readAt != null, when: when(n.createdAt), ...describeNotification(n.kind, n.payload) }));
  const unread = items.filter((i) => !i.read).length;

  return (
    <>
      <NotificationList items={items} unread={unread} />
      {items.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>You’re all caught up</CardTitle>
            <CardDescription>Job alerts, application updates and certificates will show up here.</CardDescription>
          </CardHeader>
        </Card>
      )}
    </>
  );
}
