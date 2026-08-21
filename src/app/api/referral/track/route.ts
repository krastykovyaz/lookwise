import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { getUserIdByReferralCode, recordReferralVisit } from "@/lib/db/repositories/referral";
import {
  REFERRAL_COOKIE,
  REFERRAL_COOKIE_MAX_AGE_SECONDS,
  VISITOR_COOKIE,
  VISITOR_COOKIE_MAX_AGE_SECONDS,
  encodeReferralCookie,
  decodeReferralCookie,
} from "@/lib/referral/cookies";

export const runtime = "nodejs";

const bodySchema = z.object({
  referralCode: z.string().trim().min(1).max(20),
  sourceType: z.enum(["look", "item"]),
  sourceId: z.string().trim().min(1).max(300),
});

// Called client-side (fire-and-forget, same pattern as
// lib/db/clientSync.ts) by the public Look/Item pages whenever they're
// opened with a ?ref= param. Captures attribution WITHOUT permanently
// assigning it (section 5: "do not immediately permanently assign the
// referral relationship") — it only sets a cookie an eventual signup
// can read (see auth.ts's events.createUser). First touch wins: an
// existing compass_ref cookie is never overwritten by a later visit.
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const { referralCode, sourceType, sourceId } = parsed.data;

  // Validate the code refers to a real user before writing anything —
  // an unrecognized code shouldn't plant a dead cookie or a junk visit
  // row.
  const referrerUserId = await getUserIdByReferralCode(referralCode).catch(() => null);
  if (!referrerUserId) {
    return NextResponse.json({ ok: true, tracked: false });
  }

  const cookieStore = await cookies();
  let visitorId = cookieStore.get(VISITOR_COOKIE)?.value;
  if (!visitorId) {
    visitorId = crypto.randomUUID();
    cookieStore.set(VISITOR_COOKIE, visitorId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: VISITOR_COOKIE_MAX_AGE_SECONDS,
    });
  }

  try {
    await recordReferralVisit({ referralCode, sourceType, sourceId, visitorId });
  } catch (err) {
    console.error("[POST /api/referral/track] failed to log visit:", err);
  }

  if (!decodeReferralCookie(cookieStore.get(REFERRAL_COOKIE)?.value)) {
    cookieStore.set(REFERRAL_COOKIE, encodeReferralCookie({ code: referralCode, sourceType, sourceId }), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: REFERRAL_COOKIE_MAX_AGE_SECONDS,
    });
  }

  return NextResponse.json({ ok: true, tracked: true });
}
