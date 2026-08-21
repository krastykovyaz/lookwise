import { NextResponse } from "next/server";
import { runCleanup } from "@/lib/maintenance/cleanup";

export const runtime = "nodejs";

// Section 12: "at least once per day... use the existing scheduler/
// cron architecture if one exists." This project has none, so this is
// the externally-triggerable half of the one cleanup mechanism this
// milestone adds (see src/instrumentation.ts for the other half — a
// same-process fallback for a simple self-hosted deployment with no
// external cron configured). Point any real scheduler at this route:
// a crontab entry (`curl -X POST .../api/maintenance/cleanup -H
// "Authorization: Bearer $MAINTENANCE_CLEANUP_SECRET"`), a Vercel Cron
// job, a GitHub Actions scheduled workflow, etc.
//
// Requires MAINTENANCE_CLEANUP_SECRET so this destructive-adjacent
// endpoint (it deletes rows, even though only temporary ones) can't be
// triggered by an arbitrary public request. Unset in dev is treated as
// "not configured" — the route 503s rather than silently running with
// no auth, so a real deployment can't accidentally ship without it.
export async function POST(request: Request) {
  const secret = process.env.MAINTENANCE_CLEANUP_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const stats = await runCleanup();
    return NextResponse.json({ ok: true, ...stats });
  } catch (err) {
    console.error("[POST /api/maintenance/cleanup] failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
