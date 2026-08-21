import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth/session";
import { countUnreadNotifications } from "@/lib/db/repositories/notifications";

export const runtime = "nodejs";

// GET /api/notifications/unread-count — the Profile row's badge calls
// this instead of the full list endpoint so opening Profile never has
// to fetch/render notification rows just to show a number.
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const count = await countUnreadNotifications(userId);
    return NextResponse.json({ count });
  } catch (err) {
    console.error("[GET /api/notifications/unread-count] failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
