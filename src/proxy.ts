import { NextResponse, type NextRequest } from "next/server";
import {
  REFERRAL_COOKIE,
  REFERRAL_COOKIE_MAX_AGE_SECONDS,
  VISITOR_COOKIE,
  VISITOR_COOKIE_MAX_AGE_SECONDS,
  encodeReferralCookie,
  decodeReferralCookie,
  isPlausibleReferralCode,
} from "@/lib/referral/cookies";

// Section 7-8 of the referral spec: attribution must be captured on
// the INITIAL server request, not only after React mounts — a
// visitor can open a shared link and navigate away (or straight to
// Login) before any client effect has a chance to run. Proxy (Next's
// current name for this file convention — this project previously
// used the now-deprecated middleware.ts convention, renamed here) is
// the one place that sees the raw request and can attach a
// Set-Cookie to the very first response, so this is the only
// reliable place to do it.
//
// Deliberately does NOT touch the database — this runs in the edge
// runtime by default, and better-sqlite3 (this project's DB driver)
// is Node-only. isPlausibleReferralCode is a cheap FORMAT check, not
// a real existence check: an invented-but-plausible code still just
// plants a cookie that resolves to nothing at signup (see
// getUserIdByReferralCode in auth.ts's events.createUser), so this
// never needs to be a security boundary. Real validation + the
// referral_visits click log both still happen server-side with full
// DB access, via api/referral/track (still called client-side by
// components/share/ReferralCapture) — this proxy only removes the
// dependency on that client code actually running.
export function proxy(request: NextRequest) {
  const response = NextResponse.next();

  try {
    if (!request.cookies.get(VISITOR_COOKIE)) {
      response.cookies.set(VISITOR_COOKIE, crypto.randomUUID(), {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: VISITOR_COOKIE_MAX_AGE_SECONDS,
      });
    }

    const refParam = request.nextUrl.searchParams.get("ref");
    if (!refParam || !isPlausibleReferralCode(refParam)) return response;

    // First-touch wins (section 10): never overwrite an attribution
    // that's already captured, even if this request carries a
    // different ?ref=.
    if (decodeReferralCookie(request.cookies.get(REFERRAL_COOKIE)?.value)) return response;

    const segments = request.nextUrl.pathname.split("/").filter(Boolean);
    const sourceType = segments[0] === "look" || segments[0] === "item" ? segments[0] : null;
    const sourceId = segments[1];
    if (!sourceType || !sourceId) return response;

    response.cookies.set(
      REFERRAL_COOKIE,
      encodeReferralCookie({ code: refParam, sourceType, sourceId }),
      {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: REFERRAL_COOKIE_MAX_AGE_SECONDS,
      },
    );
  } catch (err) {
    // Never let attribution capture break the page request itself.
    console.error("[proxy] referral capture failed:", err);
  }

  return response;
}

export const config = {
  // Scoped to exactly the public share routes — this intentionally
  // never matches /explore, /search, /overview, /profile, /product,
  // or any /api/* route, so it cannot affect the existing navigation/
  // state-persistence architecture (section 14). It does also match
  // the static /look and /look/onboarding pages (siblings of the
  // dynamic /look/[lookId] route under the same /look/* prefix) —
  // harmless, since without a ?ref= param this proxy is a no-op there
  // beyond ensuring the anonymous visitor cookie exists.
  matcher: ["/look/:path*", "/item/:path*"],
};
