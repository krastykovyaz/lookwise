import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth/session";
import { markNotificationRead } from "@/lib/db/repositories/notifications";

export const runtime = "nodejs";

// POST /api/notifications/[id]/read — marks ONE notification read.
// markNotificationRead scopes its UPDATE to (id, userId) in the SQL
// itself, so this can never touch another account's row no matter what
// id is supplied (section 14: never trust an entityId/id from the
// client to reach into another user's data).
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;

  try {
    const row = await markNotificationRead(userId, id);
    if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ id: row.id, readAt: row.readAt });
  } catch (err) {
    console.error("[POST /api/notifications/[id]/read] failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
