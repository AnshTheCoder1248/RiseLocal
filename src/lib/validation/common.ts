import { z } from "zod";

export const id = z.string().min(1).max(64);
/** Accepts "a,b" or repeated query params and returns an array. */
export const csv = <T extends z.ZodType>(item: T) =>
  z.preprocess(
    (v) => (v === undefined ? undefined : (Array.isArray(v) ? v : String(v).split(",")).filter(Boolean)),
    z.array(item).optional(),
  );
export const queryBool = z.preprocess((v) => (v === undefined ? undefined : v === "true" || v === "1" || v === true), z.boolean().optional());
