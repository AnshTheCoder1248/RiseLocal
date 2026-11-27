import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";

// Signed-in users skip the marketing home page: admins land on the review queue,
// businesses and community members on their own jobs, students on the job board. Optimistic check on the session cookie (no
// database work); pages still authorize every request themselves.
export default auth((req) => {
  const user = req.auth?.user;
  if (user) {
    const home = { ADMIN: "/review", EMPLOYER: "/business", COMMUNITY: "/my-jobs" }[user.role as string] ?? "/jobs";
    return NextResponse.redirect(new URL(home, req.url));
  }
});

export const config = { matcher: ["/"] };
