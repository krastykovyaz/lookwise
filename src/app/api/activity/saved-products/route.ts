import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUserId } from "@/lib/auth/session";
import { saveProduct, unsaveProduct, listSavedProducts } from "@/lib/db/repositories/activity";
import { ProductSnapshotSchema } from "@/lib/schemas";
import { productSnapshotToProduct } from "@/lib/db/repositories/reconstruct";

const postBodySchema = z.object({ product: ProductSnapshotSchema });
const deleteBodySchema = z.object({ productId: z.string().min(1) });

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ items: await listSavedProducts(userId) });
  } catch (err) {
    console.error("[GET /api/activity/saved-products] failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = postBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  try {
    await saveProduct(userId, productSnapshotToProduct(parsed.data.product));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[POST /api/activity/saved-products] failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = deleteBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  try {
    await unsaveProduct(userId, parsed.data.productId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[DELETE /api/activity/saved-products] failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
