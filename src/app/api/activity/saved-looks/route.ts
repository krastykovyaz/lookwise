import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUserId } from "@/lib/auth/session";
import { saveLook, unsaveLook, listSavedLooks } from "@/lib/db/repositories/activity";
import { LookSnapshotSchema } from "@/lib/schemas";
import { lookSnapshotToComponents } from "@/lib/db/repositories/reconstruct";

const postBodySchema = z.object({ lookId: z.string().min(1), look: LookSnapshotSchema });
const deleteBodySchema = z.object({ lookId: z.string().min(1) });

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ items: await listSavedLooks(userId) });
  } catch (err) {
    console.error("[GET /api/activity/saved-looks] failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = postBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  try {
    await saveLook(userId, parsed.data.lookId, {
      title: parsed.data.look.title,
      description: parsed.data.look.description,
      components: lookSnapshotToComponents(parsed.data.look),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[POST /api/activity/saved-looks] failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = deleteBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  try {
    await unsaveLook(userId, parsed.data.lookId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[DELETE /api/activity/saved-looks] failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
