import { handler, json, parseBody } from "@/lib/api";
import { signupSchema } from "@/lib/validation/auth";
import { hashPassword } from "@/lib/auth/password";
import { registerUser } from "@/lib/auth/signup";
import { clientIp, enforceRateLimit, LIMITS } from "@/lib/rate-limit";

// POST /api/auth/signup — role + DOB; age gate (AUTH-2) and guardian flow (AUTH-3).
export const POST = handler(async (req: Request) => {
  await enforceRateLimit(LIMITS.signupIp(clientIp(req)));
  const { password, ...profile } = await parseBody(req, signupSchema);
  await enforceRateLimit(LIMITS.signupEmail(profile.email));

  const passwordHash = await hashPassword(password); // outside the transaction: bcrypt is slow
  const result = await registerUser(profile, { passwordHash });
  return json(result, 201);
});
