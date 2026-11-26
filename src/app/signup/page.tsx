import Link from "next/link";
import type { Metadata } from "next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { GoogleIcon } from "@/components/google-icon";
import { signUpWithGoogle } from "./actions";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Create an account — RiseLocal" };

const googleEnabled = () => !!process.env.AUTH_GOOGLE_ID && !!process.env.AUTH_GOOGLE_SECRET;

export default function SignupPage() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-6 px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Create your account</CardTitle>
          <CardDescription>Find work close to home, or post a job for local teens.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {googleEnabled() && (
            <>
              <form action={signUpWithGoogle}>
                <Button type="submit" variant="outline" size="lg" className="w-full">
                  <GoogleIcon />
                  Sign up with Google
                </Button>
              </form>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <Separator className="flex-1" />
                or sign up with email
                <Separator className="flex-1" />
              </div>
            </>
          )}
          <SignupForm />
        </CardContent>
        <CardFooter className="text-sm text-muted-foreground">
          Already have an account?&nbsp;<Link href="/login" className="text-foreground underline underline-offset-4">Sign in</Link>
        </CardFooter>
      </Card>
    </main>
  );
}
