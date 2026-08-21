import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUserId } from "@/lib/auth/session";
import { recordViewedProduct, listViewedProducts } from "@/lib/db/repositories/activity";
import { ProductSnapshotSchema } from "@/lib/schemas";
import { productSnapshotToProduct } from "@/lib/db/repositories/reconstruct";

const bodySchema = z.object({ product: ProductSnapshotSchema, provider: z.string().optional() });

export async function POST(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  try {
    await recordViewedProduct(userId, productSnapshotToProduct(parsed.data.product), parsed.data.provider ?? "ebay");
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[POST /api/activity/viewed] failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

// GET /api/activity/viewed             -> { items: [...] } (default cap,
//   see listViewedProducts's own default — unchanged from before).
// GET /api/activity/viewed?limit=10    -> { items: [...] }, at most
//   `limit` rows, newest first, applied server-side via SQL LIMIT
//   (listViewedProducts orders by viewedAt desc and limits in the
//   query itself — this never fetches more rows than requested just
//   to slice them in JS). Clamped to a sane range so a client can't
//   force an unbounded scan.
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
    return NextResponse.json({ items: await listViewedProducts(userId, limit) });
  } catch (err) {
    console.error("[GET /api/activity/viewed] failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
