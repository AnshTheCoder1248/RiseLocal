import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import type { Metadata } from "next";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { ResumeForm } from "./resume-form";

export const metadata: Metadata = { title: "My resume — RiseLocal" };

export default function ResumePage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">My resume</h1>
        <p className="text-muted-foreground">
          Upload a resume to keep it ready for applications. Only you can see it here.
        </p>
      </header>
      <Suspense fallback={<Skeleton className="h-48 w-full rounded-xl" />}>
        <Resume />
      </Suspense>
    </main>
  );
}

async function Resume() {
  await connection();
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/resume");
  if (user.role !== "STUDENT") redirect("/jobs");
  const resume = await db.resume.findUnique({
    where: { userId: user.id },
    select: { fileName: true, size: true, uploadedAt: true },
  });
  return (
    <>
      <ResumeForm current={resume ? { ...resume, uploadedAt: resume.uploadedAt.toISOString() } : null} />
      <p className="text-sm text-muted-foreground">
        Don’t include your home address or phone number. Posters reach you through RiseLocal.{" "}
        <Link href="/jobs" className="underline underline-offset-4 hover:text-foreground">Browse jobs</Link>
      </p>
    </>
  );
}
