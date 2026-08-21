import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth/session";
import { listNotifications, countUnreadNotifications } from "@/lib/db/repositories/notifications";

export const runtime = "nodejs";

// GET /api/notifications?limit=20&before=<ISO timestamp>
// Always scoped to the authenticated caller (section 13/14 — userId
// comes from the session, never a client-supplied value). `before`
// pages further back once the client has exhausted the current page
// (see listNotifications's own doc for why a createdAt cursor, not
// OFFSET). unreadCount always reflects the caller's FULL unread set,
// independent of `limit`/`before`, so the Profile badge and the
// Notifications page's "Mark all as read" affordance stay correct
// even before every page has been loaded.
export async function GET(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const { searchParams } = new URL(request.url);
    const limitParam = Number(searchParams.get("limit"));
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : undefined;
    const beforeParam = searchParams.get("before");
    const before = beforeParam ? new Date(beforeParam) : undefined;
    if (before && Number.isNaN(before.getTime())) {
      return NextResponse.json({ error: "invalid_request", message: "'before' must be a valid date." }, { status: 400 });
    }

    const [{ items, hasMore }, unreadCount] = await Promise.all([
      listNotifications(userId, { limit, before }),
      countUnreadNotifications(userId),
    ]);

    return NextResponse.json({ items, hasMore, unreadCount });
  } catch (err) {
    console.error("[GET /api/notifications] failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
