// Pure state-resolution logic for the subscription page — kept out of
// the component so it's directly unit-testable (mirrors
// lib/explore/prefetch.ts's shouldPrefetch: a small pure function the
// UI calls, not logic buried inside a React effect). See
// scripts/verify-payments.ts for the tests.

export interface SubscriptionStatusPayment {
  status: string;
  paymentUrl: string | null;
}

export interface SubscriptionStatusResponse {
  subscription: { status: string; startedAt: string; expiresAt: string } | null;
  payment: SubscriptionStatusPayment | null;
}

export type SubscriptionViewState =
  | { kind: "none" }
  | { kind: "pending"; status: string; paymentUrl: string | null }
  | { kind: "partially_paid"; paymentUrl: string | null }
  | { kind: "terminal"; status: "failed" | "expired" | "refunded" }
  | { kind: "active"; expiresAt: string };

const TERMINAL_FAILURE_STATUSES = new Set(["failed", "expired", "refunded"]);

/** An active subscription always wins regardless of what the most
 *  recent payment's own status says (section 4 of the Step 3 spec:
 *  "only finished means the subscription is active" — and once it is,
 *  that's the state to show, not a stale/unrelated payment status).
 *  "finished" with no active subscription yet is treated as still
 *  in-progress rather than reset to "none" — in this app's own
 *  implementation the IPN activates the subscription in the same
 *  request that marks the payment finished, so this is normally
 *  momentary at most, and polling naturally resolves it. */
export function resolveSubscriptionViewState(data: SubscriptionStatusResponse | null): SubscriptionViewState {
  if (data?.subscription?.status === "active") {
    return { kind: "active", expiresAt: data.subscription.expiresAt };
  }

  const payment = data?.payment;
  if (!payment) return { kind: "none" };

  if (payment.status === "partially_paid") {
    return { kind: "partially_paid", paymentUrl: payment.paymentUrl };
  }
  if (TERMINAL_FAILURE_STATUSES.has(payment.status)) {
    return { kind: "terminal", status: payment.status as "failed" | "expired" | "refunded" };
  }
  // waiting | confirming | confirmed | sending | finished(-not-yet-reflected)
  return { kind: "pending", status: payment.status, paymentUrl: payment.paymentUrl };
}

/** Section 5: "stop polling after finished/failed/expired/refunded" —
 *  polling continues only while there's genuinely something that might
 *  still change (an in-flight or partially-paid payment with no active
 *  subscription yet). */
export function shouldContinuePolling(state: SubscriptionViewState): boolean {
  return state.kind === "pending" || state.kind === "partially_paid";
}
