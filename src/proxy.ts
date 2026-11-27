import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";

// Signed-in users skip the marketing home page: admins land on the review queue,
// businesses on their dashboard, everyone else on the job board. Optimistic check on the session cookie (no
// database work); pages still authorize every request themselves.
export default auth((req) => {
  const user = req.auth?.user;
  if (user) {
    const home = user.role === "ADMIN" ? "/review" : user.role === "EMPLOYER" ? "/business" : "/jobs";
    return NextResponse.redirect(new URL(home, req.url));
  }
});

export const config = { matcher: ["/"] };
