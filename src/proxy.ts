import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";

// Signed-in users skip the marketing home page and land on the job board.
// Optimistic check on the session cookie (no database work); pages still
// authorize every request themselves.
export default auth((req) => {
  if (req.auth?.user) return NextResponse.redirect(new URL("/jobs", req.url));
});

export const config = { matcher: ["/"] };
