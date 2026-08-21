import { z } from "zod";

export const postBodySchema = z.object({
  productId: z.string().min(1),
  signal: z.enum(["like", "dislike"]),
});

export const deleteBodySchema = z.object({ productId: z.string().min(1) });
