import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth/session";
import { markAllNotificationsRead } from "@/lib/db/repositories/notifications";

export const runtime = "nodejs";

// POST /api/notifications/read-all — marks every unread notification
// for the authenticated caller as read in one statement.
export async function POST() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const updated = await markAllNotificationsRead(userId);
    return NextResponse.json({ updated });
  } catch (err) {
    console.error("[POST /api/notifications/read-all] failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
