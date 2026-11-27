"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Award, Bell, CheckCheck, Info, Send } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import type { NotificationView } from "@/lib/notification-text";

type Item = NotificationView & { id: string; read: boolean; when: string };

const ICONS = { bell: Bell, send: Send, award: Award, info: Info };

async function markRead(body: { ids: string[] } | { all: true }) {
  const res = await fetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error();
}

export function NotificationList({ items, unread }: { items: Item[]; unread: number }) {
  const router = useRouter();
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const isRead = (i: Item) => i.read || readIds.has(i.id);
  const unreadNow = items.filter((i) => !isRead(i)).length;

  async function open(item: Item) {
    if (isRead(item)) return;
    setReadIds((s) => new Set(s).add(item.id));
    // Fire and forget: navigation shouldn't wait on it, and the sidebar count refreshes after.
    markRead({ ids: [item.id] }).then(() => router.refresh()).catch(() => {});
  }

  async function markAll() {
    setBusy(true);
    try {
      await markRead({ all: true });
      setReadIds(new Set(items.map((i) => i.id)));
      toast.success("All notifications marked as read");
      router.refresh();
    } catch {
      toast.error("Couldn’t update notifications. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-semibold tracking-tight">Notifications</h1>
          <p className="text-muted-foreground">{unreadNow ? `${unreadNow} unread` : unread || items.length ? "No unread notifications" : "Nothing here yet"}</p>
        </div>
        {unreadNow > 0 && (
          <Button variant="outline" size="sm" onClick={markAll} disabled={busy}>
            <CheckCheck aria-hidden />
            {busy ? "Marking…" : "Mark all as read"}
          </Button>
        )}
      </header>

      {items.length > 0 && (
        <ul className="flex flex-col overflow-hidden rounded-xl border">
          {items.map((item) => {
            const Icon = ICONS[item.icon];
            const read = isRead(item);
            const body = (
              <>
                <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full", read ? "bg-muted text-muted-foreground" : "bg-primary text-primary-foreground")}>
                  <Icon className="size-4" aria-hidden />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className={cn("text-sm", read ? "text-foreground" : "font-semibold")}>{item.title}</span>
                  {item.body && <span className="truncate text-sm text-muted-foreground">{item.body}</span>}
                </span>
                <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                  {item.when}
                  {!read && <span className="size-2 rounded-full bg-primary" aria-label="Unread" />}
                </span>
              </>
            );
            const cls = cn(
              "flex items-start gap-3 border-b px-4 py-3 text-left outline-none transition-colors last:border-b-0 focus-visible:bg-muted",
              read ? "bg-background" : "bg-muted/40",
              (item.href || !read) && "hover:bg-muted/70",
            );
            return (
              <li key={item.id} className="contents">
                {item.href ? (
                  <Link href={item.href} onClick={() => open(item)} className={cls}>{body}</Link>
                ) : (
                  <button type="button" onClick={() => open(item)} className={cn(cls, "w-full")}>{body}</button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
