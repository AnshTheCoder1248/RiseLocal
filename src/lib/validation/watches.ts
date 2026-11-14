import { z } from "zod";
import { boardFilterSchema } from "./jobs";

const channels = z.array(z.enum(["in_app", "email"])).min(1).max(2);

export const createWatchSchema = z.object({
  name: z.string().trim().min(1).max(80),
  filters: boardFilterSchema,
  channels: channels.default(["in_app"]),
  frequency: z.enum(["instant", "daily"]).default("instant"),
});

export const updateWatchSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    filters: boardFilterSchema,
    channels,
    frequency: z.enum(["instant", "daily"]),
    active: z.boolean(),
  })
  .partial();
