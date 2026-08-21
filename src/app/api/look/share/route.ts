import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { LookSnapshotSchema } from "@/lib/schemas";
import { lookSnapshotToComponents } from "@/lib/db/repositories/reconstruct";
import { createLook } from "@/lib/db/repositories/look";

export const runtime = "nodejs";

const bodySchema = z.object({ look: LookSnapshotSchema });

// Gives a look a public, durable id it can be shared under
// (/look/[lookId] — see that route's page.tsx) even if it was never
// explicitly saved or re-opened from history. Auth is OPTIONAL here on
// purpose: `looks.userId` is nullable (see schema/domain.ts's comment
// on that column), so a guest's freshly generated look can get a real
// shareable link too (section 15: "guests can... share/copy canonical
// links"). Guests just never get a ?ref= code appended client-side,
// since only an authenticated user has one (section 4).
//
// Not deduped against a previous share of the "same" look — repeated
// calls create additional snapshot rows, matching the existing
// saveLook/recordViewedLook behavior (lib/db/repositories/activity.ts)
// this reuses createLook from. Each id stays valid forever either way
// (loadLooksByRowId never deletes), so this is a minor storage
// inefficiency, not a correctness issue; the client caches the id it
// gets back so a given browser session only calls this once per look.
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const session = await auth();
  const userId = session?.user?.id ?? null;

  try {
    const snapshot = await createLook({
      userId,
      title: parsed.data.look.title,
      description: parsed.data.look.description ?? null,
      provider: "ebay",
      components: lookSnapshotToComponents(parsed.data.look),
    });
    return NextResponse.json({ lookId: snapshot.id });
  } catch (err) {
    console.error("[POST /api/look/share] failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
