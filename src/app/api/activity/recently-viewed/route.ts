import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth/session";
import { listRecentlyViewed } from "@/lib/db/repositories/activity";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 10;

// GET /api/activity/recently-viewed[?limit=N] -> { items: [...] },
// products and looks the authenticated user actually opened, merged
// into one chronological (newest-first) list — what Overview's single
// "Recently Viewed" section renders for signed-in users. Capped
// server-side (never returns more than MAX_LIMIT regardless of what's
// requested) so Overview never grows unbounded.
export async function GET(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const limitParam = searchParams.get("limit");
  let limit = DEFAULT_LIMIT;
  if (limitParam !== null) {
    const parsedLimit = Number(limitParam);
    if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
      return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    }
    limit = Math.min(Math.trunc(parsedLimit), MAX_LIMIT);
  }

  try {
    return NextResponse.json({ items: await listRecentlyViewed(userId, limit) });
  } catch (err) {
    console.error("[GET /api/activity/recently-viewed] failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
