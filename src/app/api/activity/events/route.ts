import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUserId } from "@/lib/auth/session";
import { recordEvent, listEvents } from "@/lib/db/repositories/activity";
import type { PreferenceEventType } from "@/types/events";

const bodySchema = z.object({
  type: z.string().min(1),
  timestamp: z.string(),
  productId: z.string().nullable().optional(),
  lookId: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  brand: z.string().nullable().optional(),
  price: z.number().nullable().optional(),
  source: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).nullable().optional(),
});

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ items: await listEvents(userId) });
}

export async function POST(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  await recordEvent(userId, { ...parsed.data, type: parsed.data.type as PreferenceEventType });
  return NextResponse.json({ ok: true });
}
