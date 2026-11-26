import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentUser } from "@/lib/auth/session";
import { UserMenu } from "./user-menu";

export function SiteHeader() {
  return (
    <header className="border-b">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-4 px-4 sm:px-6">
        <Link href="/" className="font-semibold tracking-tight">RiseLocal</Link>
        <div className="ml-auto flex items-center gap-2">
          {/* Reads the session, so it streams in; the rest of the header is static. */}
          <Suspense fallback={<Skeleton className="size-8 rounded-full" />}>
            <Account />
          </Suspense>
        </div>
      </div>
    </header>
  );
}

async function Account() {
  await connection();
  const user = await getCurrentUser();
  if (!user) {
    return (
      <>
        <Link href="/login" className={buttonVariants({ variant: "ghost", size: "sm" })}>Sign in</Link>
        <Link href="/signup" className={buttonVariants({ size: "sm" })}>Sign up</Link>
      </>
    );
  }
  return (
    <>
      {user.role === "COMMUNITY" && (
        <Link href="/post" className={buttonVariants({ variant: "outline", size: "sm" })}>Post a gig</Link>
      )}
      <UserMenu name={user.displayName} email={user.email} image={user.image} role={user.role} />
    </>
  );
}
