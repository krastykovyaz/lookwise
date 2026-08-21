// First-party cookie constants for anonymous referral attribution
// (section 5 of the shareable-links spec: "prefer a first-party
// cookie/session mechanism... do NOT use localStorage as the primary
// referral mechanism"). Shared between:
//  - src/middleware.ts, which captures ?ref= on the raw server
//    request (edge runtime — no DB access, so it only does a cheap
//    FORMAT check via isPlausibleReferralCode, not a real existence
//    check),
//  - api/referral/track, which does the real DB validation + visit
//    logging,
//  - auth.ts's events.createUser, which reads the cookie back at
//    signup,
// so none of the three can drift on the cookie shape or the code
// format.

export const REFERRAL_COOKIE = "compass_ref";
export const VISITOR_COOKIE = "compass_vid";

// 30 days: long enough to survive a slow "saw it on Telegram, signed
// up next week" path without holding attribution data indefinitely.
export const REFERRAL_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
// 180 days: purely a stable anonymous id for click analytics, not
// itself attribution — safe to live longer.
export const VISITOR_COOKIE_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;

// Must match lib/db/repositories/referral.ts's randomCode() — kept
// here (rather than there) because this file has to be edge-safe
// (imported by middleware.ts), and referral.ts imports "server-only" +
// the DB client.
export const REFERRAL_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const REFERRAL_CODE_LENGTH = 6;

/** Cheap, DB-free format check — NOT a real existence check. Used by
 *  middleware (edge runtime, no DB access) to avoid planting a cookie
 *  for an obviously-garbage ?ref= value. The actual "does this code
 *  belong to a real user" check still happens where it always did —
 *  at signup time, via getUserIdByReferralCode — so a
 *  plausible-but-nonexistent code simply never produces a Referral
 *  row; it's never treated as a security boundary. */
export function isPlausibleReferralCode(code: string): boolean {
  if (code.length !== REFERRAL_CODE_LENGTH) return false;
  for (const char of code) {
    if (!REFERRAL_CODE_ALPHABET.includes(char)) return false;
  }
  return true;
}

export interface ReferralCookiePayload {
  code: string;
  sourceType: "look" | "item";
  sourceId: string;
}

export function encodeReferralCookie(payload: ReferralCookiePayload): string {
  return JSON.stringify(payload);
}

/** Never throws — a malformed/tampered cookie just means "no
 *  attribution", not a request failure. */
export function decodeReferralCookie(raw: string | undefined): ReferralCookiePayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ReferralCookiePayload>;
    if (typeof parsed.code !== "string" || !parsed.code.trim()) return null;
    return {
      code: parsed.code,
      sourceType: parsed.sourceType === "item" ? "item" : "look",
      sourceId: typeof parsed.sourceId === "string" ? parsed.sourceId : "",
    };
  } catch {
    return null;
  }
}
