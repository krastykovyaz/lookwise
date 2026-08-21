import { NextResponse } from "next/server";
import { z } from "zod";
import { askAboutProduct, DeepSeekConfigError, DeepSeekApiError } from "@/lib/ai";

export const runtime = "nodejs";

const ProductSchema = z.object({
  title: z.string(),
  price: z.number(),
  currency: z.string(),
  condition: z.string(),
  brand: z.string().nullable(),
  color: z.string().nullable(),
  seller: z
    .object({
      username: z.string(),
      feedbackScore: z.number().nullable(),
      feedbackPercentage: z.number().nullable(),
    })
    .nullable(),
  location: z.string().nullable(),
  shipping: z
    .object({
      cost: z.number().nullable(),
      currency: z.string().nullable(),
      service: z.string().nullable(),
      estimatedDelivery: z.string().nullable(),
      shipsTo: z.string().nullable(),
    })
    .nullable(),
  returnPolicy: z.string().nullable(),
  dealScore: z.number().nullable(),
});

const AskRequestSchema = z.object({
  question: z.string().trim().min(1).max(500),
  locale: z.enum(["en", "ru", "fr"]).optional().default("en"),
  // Accepts the product object the client already has in memory from
  // its last search/details fetch, so we don't need a database to look
  // it back up — the client is the source of "which item", eBay (via
  // the earlier normalize step) remains the source of the item's facts.
  product: ProductSchema,
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_request", message: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const parsed = AskRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", message: "Request must include 'question' and 'product'." },
      { status: 400 },
    );
  }

  try {
    const answer = await askAboutProduct(
      parsed.data.question,
      parsed.data.product,
      parsed.data.locale,
    );
    return NextResponse.json({ answer });
  } catch (err) {
    if (err instanceof DeepSeekConfigError) {
      return NextResponse.json(
        { error: "server_misconfigured", message: "Ask Compass is not configured yet." },
        { status: 503 },
      );
    }
    if (err instanceof DeepSeekApiError) {
      return NextResponse.json(
        { error: "ai_unavailable", message: "Compass couldn't reach its AI service." },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { error: "unknown", message: "Something went wrong answering that." },
      { status: 500 },
    );
  }
}
