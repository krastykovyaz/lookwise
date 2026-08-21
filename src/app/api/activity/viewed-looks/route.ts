import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUserId } from "@/lib/auth/session";
import { recordViewedLook, listViewedLooks } from "@/lib/db/repositories/activity";
import { LookSnapshotSchema } from "@/lib/schemas";
import { lookSnapshotToComponents } from "@/lib/db/repositories/reconstruct";

const bodySchema = z.object({ lookId: z.string().min(1), look: LookSnapshotSchema });

// Mirrors /api/activity/viewed (products) but for looks — kept as its
// own route rather than folded into the products one since they're
// recorded from different call sites (look/page.tsx vs product
// detail) and have different DB tables underneath (viewed_look vs
// viewed_product). See /api/activity/recently-viewed for the combined
// read side Overview actually uses.
export async function POST(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  try {
    await recordViewedLook(userId, parsed.data.lookId, {
      title: parsed.data.look.title,
      description: parsed.data.look.description,
      components: lookSnapshotToComponents(parsed.data.look),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[POST /api/activity/viewed-looks] failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const limitParam = searchParams.get("limit");
  let limit: number | undefined;
  if (limitParam !== null) {
    const parsedLimit = Number(limitParam);
    if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
      return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    }
    limit = Math.min(Math.trunc(parsedLimit), 10);
  }

  try {
    return NextResponse.json({ items: await listViewedLooks(userId, limit) });
  } catch (err) {
    console.error("[GET /api/activity/viewed-looks] failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
