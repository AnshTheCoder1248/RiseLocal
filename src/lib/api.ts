import { connection, NextResponse } from "next/server";
import { z, ZodError, type ZodType } from "zod";
import { Prisma } from "@/generated/prisma/client";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
    public headers?: Record<string, string>,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) => new ApiError(400, msg, details);
export const unauthorized = (msg = "Sign in required") => new ApiError(401, msg);
export const forbidden = (msg = "You don't have access to this") => new ApiError(403, msg);
export const notFound = (msg = "Not found") => new ApiError(404, msg);
export const conflict = (msg: string) => new ApiError(409, msg);
export const unprocessable = (msg: string, details?: unknown) => new ApiError(422, msg, details);

export function json<T>(data: T, init?: number | ResponseInit) {
  return NextResponse.json(data, typeof init === "number" ? { status: init } : init);
}

/**
 * Wraps a route handler with uniform error → JSON response mapping.
 * API routes are always request-time (auth + DB), so opt out of build-time prerendering.
 */
export function handler<Args extends unknown[]>(fn: (...args: Args) => Promise<Response>) {
  return async (...args: Args): Promise<Response> => {
    await connection();
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof ApiError) {
        return json({ error: err.message, details: err.details }, { status: err.status, headers: err.headers });
      }
      if (err instanceof ZodError) {
        return json({ error: "Invalid input", details: z.flattenError(err) }, 400);
      }
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === "P2002") return json({ error: "Already exists" }, 409);
        if (err.code === "P2025") return json({ error: "Not found" }, 404);
      }
      console.error(err);
      return json({ error: "Something went wrong" }, 500);
    }
  };
}

export async function parseBody<S extends ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw badRequest("Request body must be JSON");
  }
  return schema.parse(body);
}

export function parseQuery<S extends ZodType>(req: Request, schema: S): z.infer<S> {
  const params = new URL(req.url).searchParams;
  const obj: Record<string, string | string[]> = {};
  for (const key of new Set(params.keys())) {
    const all = params.getAll(key);
    obj[key] = all.length > 1 ? all : all[0];
  }
  return schema.parse(obj);
}
