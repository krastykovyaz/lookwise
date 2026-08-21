import "server-only";
import { getActiveSubscriptionForUser } from "@/lib/db/repositories/payments";

// The single server-side source of truth for "does this user currently
// have an active Lookwise subscription" — every caller (the status
// endpoint, any future protected route/gate) goes through these
// functions rather than re-deriving `subscription.status === "active"`
// inline. Signature convention matches the rest of this codebase's
// payments module (createSubscriptionPayment, notifyUnavailableItem,
// etc.): an explicit userId parameter, resolved by the caller from the
// session — these never call getSessionUserId() themselves, so they
// work equally from a route handler, a background job, or a test.

export type SubscriptionEntitlementStatus = "active" | "expired" | "none";

export interface UserSubscriptionInfo {
  status: SubscriptionEntitlementStatus;
  expiresAt: Date | null;
}

/** "Active" means status='active' in the DB AND the current time is
 *  still before expiresAt — checked here, every call, rather than
 *  trusted from the stored status column alone. Nothing currently
 *  sweeps an expired subscription's status back to something else (see
 *  activateSubscriptionForPayment's own renewal-path exception to
 *  that), so a DB row can sit at status='active' long after it should
 *  no longer count — this is what makes that harmless to read. */
export async function getUserSubscription(userId: string | null): Promise<UserSubscriptionInfo> {
  if (!userId) return { status: "none", expiresAt: null };

  const row = await getActiveSubscriptionForUser(userId);
  if (!row) return { status: "none", expiresAt: null };

  const isExpired = row.expiresAt.getTime() <= Date.now();
  return { status: isExpired ? "expired" : "active", expiresAt: row.expiresAt };
}

/** Unauthenticated (`userId === null`) is always false — never treated
 *  as an active subscriber (section 5). */
export async function isSubscriptionActive(userId: string | null): Promise<boolean> {
  const info = await getUserSubscription(userId);
  return info.status === "active";
}

export class SubscriptionRequiredError extends Error {
  constructor(message = "An active subscription is required.") {
    super(message);
    this.name = "SubscriptionRequiredError";
  }
}

/** For a protected server-side operation (section 5: "must be enforced
 *  server-side... do not rely only on hiding/disabling buttons in
 *  React"). No such operation exists in the product yet (section 4:
 *  "do not invent one") — this is the primitive any future one calls,
 *  e.g.:
 *
 *    const userId = await getSessionUserId();
 *    await requireActiveSubscription(userId); // throws if not entitled
 *    // ...proceed with the protected operation
 *
 *  Throws SubscriptionRequiredError rather than returning a boolean so
 *  a route can't accidentally ignore a false return and continue
 *  anyway — the caller must handle the throw (typically a 402/403
 *  response) to reach the protected code path at all. */
export async function requireActiveSubscription(userId: string | null): Promise<void> {
  if (!(await isSubscriptionActive(userId))) {
    throw new SubscriptionRequiredError();
  }
}
