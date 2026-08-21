import "server-only";

// Section 4 of the payments spec: "use a clear configurable duration
// constant rather than hardcoding it in multiple places... make the
// duration easy to change later." This is the ONE place a subscription's
// length is defined — everything else (webhook.ts's activation logic,
// any future renewal/expiry-sweep code) computes from this constant
// rather than repeating a raw number of days/ms.
export const SUBSCRIPTION_DURATION_DAYS = 30;
export const SUBSCRIPTION_DURATION_MS = SUBSCRIPTION_DURATION_DAYS * 24 * 60 * 60 * 1000;

export function computeSubscriptionExpiry(startedAt: Date): Date {
  return new Date(startedAt.getTime() + SUBSCRIPTION_DURATION_MS);
}
