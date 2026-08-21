import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth/session";
import {
  getUserProductSignal,
  getUserProductSignals,
  listPreferenceSignals,
  removeProductSignal,
  upsertProductSignal,
} from "@/lib/db/repositories/activity";
import { resolveSignalToggle } from "@/lib/style/signalLogic";
import { postBodySchema, deleteBodySchema } from "@/lib/style/signalSchemas";

// GET /api/activity/signals            -> { items: [...] } (unchanged —
//   full raw signal log for this user, used nowhere in the UI today but
//   kept for parity with the other /api/activity/* list endpoints).
// GET /api/activity/signals?productIds=id1,id2,id3
//   -> { signals: { id1: "like", id2: "dislike" } } — batch restore for
//   a page of products (section 5: never one request per product).
//   Only ever returns signals belonging to the authenticated caller.
export async function GET(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const { searchParams } = new URL(request.url);
    const productIdsParam = searchParams.get("productIds");
    if (productIdsParam !== null) {
      const productIds = productIdsParam
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);
      const signals = await getUserProductSignals(userId, productIds);
      return NextResponse.json({ signals });
    }

    return NextResponse.json({ items: await listPreferenceSignals(userId) });
  } catch (err) {
    console.error("[GET /api/activity/signals] failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

// POST /api/activity/signals
//   { productId, signal: "like" | "dislike" }
// Sets the caller's current signal for a product (upsert — a repeat
// click of the same button, or switching like<->dislike, always
// results in exactly one row, never a duplicate). Clicking the
// already-active signal again clears it back to neutral (section 5's
// "clicking the currently active button can remove/reset the
// feedback").
export async function POST(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = postBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 });
  }
  const { productId, signal } = parsed.data;

  try {
    const current = await getUserProductSignal(userId, productId);
    const next = resolveSignalToggle(current, signal);
    if (next === null) {
      await removeProductSignal(userId, productId);
      return NextResponse.json({ signal: null });
    }
    await upsertProductSignal(userId, productId, next);
    return NextResponse.json({ signal: next });
  } catch (err) {
    // Log the real cause server-side (this is exactly what was
    // missing when this route was returning bare 500s with no way to
    // diagnose them — see the "signal_http_500" investigation). Never
    // put the raw error in the response body: a driver/SQL error can
    // contain schema details, and returning it would violate section
    // 3's "do not expose sensitive information".
    console.error("[POST /api/activity/signals] failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

// DELETE /api/activity/signals { productId } — explicit reset, for a
// client that wants to clear a signal without relying on the
// click-the-active-button-again toggle behavior above.

export async function DELETE(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = deleteBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  try {
    await removeProductSignal(userId, parsed.data.productId);
    return NextResponse.json({ signal: null });
  } catch (err) {
    console.error("[DELETE /api/activity/signals] failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
