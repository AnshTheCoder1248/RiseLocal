import Link from "next/link";
import { Suspense } from "react";
import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { safeNext } from "@/lib/jobs/format";
import { GoogleIcon } from "@/components/google-icon";
import { loginWithGoogle } from "./actions";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in — RiseLocal" };

const ERRORS: Record<string, string> = {
  AccessDenied: "Google sign-in isn’t available for this account. Use your email and password instead.",
  OAuthAccountNotLinked: "That email is already linked to a different sign-in method.",
  rate_limited: "Too many sign-in attempts. Wait a few minutes and try again.",
  CredentialsSignin: "Email or password is incorrect.",
};

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-4 py-12">
      <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">← RiseLocal</Link>
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Sign in</CardTitle>
          <CardDescription>Welcome back. Sign in to apply and track your applications.</CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={<Skeleton className="h-48 w-full" />}>
            <Form searchParams={searchParams} />
          </Suspense>
        </CardContent>
        <CardFooter className="text-sm text-muted-foreground">
          New here?&nbsp;<Link href="/signup" className="text-foreground underline underline-offset-4">Create an account</Link>
        </CardFooter>
      </Card>
    </main>
  );
}

async function Form({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const code = typeof sp.code === "string" ? sp.code : undefined;
  const error = typeof sp.error === "string" ? sp.error : undefined;
  const next = safeNext(sp.next);
  const googleEnabled = !!process.env.AUTH_GOOGLE_ID && !!process.env.AUTH_GOOGLE_SECRET;
  return (
    <div className="flex flex-col gap-4">
      {googleEnabled && (
        <>
          <form action={loginWithGoogle}>
            <input type="hidden" name="next" value={next} />
            <Button type="submit" variant="outline" size="lg" className="w-full">
              <GoogleIcon />
              Continue with Google
            </Button>
          </form>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <Separator className="flex-1" />
            or
            <Separator className="flex-1" />
          </div>
        </>
      )}
      <LoginForm next={next} initialError={(code && ERRORS[code]) || (error && (ERRORS[error] ?? "Sign-in failed. Please try again."))} />
    </div>
  );
}
