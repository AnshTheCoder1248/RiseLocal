import { connection } from "next/server";
import { Suspense } from "react";
import type { Metadata } from "next";
import { Skeleton } from "@/components/ui/skeleton";
import { PostGigForm } from "@/app/post/post-gig-form";
import { requireBusiness } from "../business-user";

export const metadata: Metadata = { title: "Post a job — RiseLocal" };

export default function PostJobPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Post a job</h1>
        <p className="text-muted-foreground">Reach local teens looking for part-time work. You can publish now or save a draft.</p>
      </header>
      <Suspense fallback={<Skeleton className="h-[600px] w-full rounded-xl" />}>
        <Form />
      </Suspense>
    </main>
  );
}

async function Form() {
  await connection();
  const { user } = await requireBusiness("/business/post");
  if (user.status !== "ACTIVE") {
    return <p className="rounded-lg border px-4 py-3 text-sm text-muted-foreground">Finish activating your account before posting a job.</p>;
  }
  return <PostGigForm kind="job" canPublish doneHref="/business" />;
}
