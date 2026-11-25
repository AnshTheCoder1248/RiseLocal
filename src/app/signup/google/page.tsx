import Link from "next/link";
import { cookies } from "next/headers";
import { Suspense } from "react";
import type { Metadata } from "next";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { GOOGLE_SIGNUP_COOKIE } from "@/lib/auth/config";
import { verifyToken } from "@/lib/tokens";
import { GoogleSignupForm } from "./google-signup-form";

export const metadata: Metadata = { title: "Finish signing up — RiseLocal" };

export default function GoogleSignupPage() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-6 px-4 py-12">
      <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">← RiseLocal</Link>
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Finish creating your account</CardTitle>
          <CardDescription>A couple of details so we can show jobs that fit you and keep younger users safe.</CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={<Skeleton className="h-80 w-full" />}>
            <Step />
          </Suspense>
        </CardContent>
      </Card>
    </main>
  );
}

async function Step() {
  const identity = verifyToken((await cookies()).get(GOOGLE_SIGNUP_COOKIE)?.value ?? "", "google-signup");
  if (!identity) {
    return (
      <div className="flex flex-col items-start gap-3 text-sm">
        <p>Your Google sign-in has expired or wasn’t started. Start again from the sign-up page.</p>
        <Link href="/signup" className={buttonVariants({ variant: "outline" })}>Back to sign up</Link>
      </div>
    );
  }
  return <GoogleSignupForm name={identity.name} email={identity.email} />;
}
