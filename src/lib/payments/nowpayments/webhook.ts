import "server-only";
import {
  getPaymentByProviderPaymentId,
  getPaymentByOrderId,
  linkProviderPaymentId,
  updatePaymentFromIpn,
  activateSubscriptionForPayment,
  type PaymentRow,
} from "@/lib/db/repositories/payments";
import type { NowPaymentsIpnInput } from "@/lib/schemas";

// NOWPayments' documented status vocabulary. Every one of these is
// recorded on the payment row verbatim; only "finished" additionally
// activates a subscription. "partially_paid" is listed explicitly to
// make it unmistakable that it is NOT a success state (section 3:
// "partially paid must NOT activate the subscription") even though it
// falls out naturally from the same "only finished activates" check
// below — this array isn't used for branching, just documentation.
export const NOWPAYMENTS_IPN_STATUSES = [
  "waiting",
  "confirming",
  "confirmed",
  "sending",
  "partially_paid",
  "finished",
  "failed",
  "expired",
  "refunded",
] as const;

const SUCCESS_STATUS = "finished";

export type IpnProcessingOutcome =
  | { outcome: "unknown_payment" }
  | { outcome: "processed"; status: string; subscriptionActivated: boolean };

/** Applies one already-signature-verified IPN event. Called by the
 *  webhook route only after verifyIpnSignature has passed — this
 *  function itself does not check the signature and must never be
 *  reachable with unverified input (section 3: "verify signature
 *  before processing... reject invalid signatures").
 *
 *  Idempotent by construction, not by an extra "have I seen this
 *  before" check: updatePaymentFromIpn is a plain UPDATE (repeating it
 *  with the same status is a no-op change), and
 *  activateSubscriptionForPayment's own unique-index guards mean a
 *  replayed "finished" IPN can never create a second subscription
 *  (section 3: "repeated identical IPNs must be safe... must not
 *  create duplicate subscriptions"). NOWPayments identifies the
 *  payment by their own payment_id — the local user id is never taken
 *  from this payload (section 3: "do not trust userId from the
 *  webhook"); it comes from whichever user row the matched payment
 *  already belongs to. */
export async function processIpnEvent(payload: NowPaymentsIpnInput): Promise<IpnProcessingOutcome> {
  const providerPaymentId = String(payload.payment_id);
  let payment: PaymentRow | null = await getPaymentByProviderPaymentId(providerPaymentId);

  if (!payment && payload.order_id) {
    // The hosted-invoice flow (checkout.ts) doesn't know NOWPayments'
    // real payment_id at creation time — the row was created with the
    // invoice id as a placeholder, correlated instead by our own
    // order_id (which NOWPayments echoes back on every IPN). The FIRST
    // IPN for such a payment won't match by providerPaymentId yet;
    // find it by order_id instead and upgrade the placeholder to the
    // real id, so every later IPN for the same payment matches
    // directly without this fallback.
    const byOrderId = await getPaymentByOrderId(payload.order_id);
    if (byOrderId) {
      payment = await linkProviderPaymentId(byOrderId.id, providerPaymentId);
    }
  }

  if (!payment) {
    console.warn(`[Compass] NOWPayments IPN: unknown payment_id "${providerPaymentId}" — ignoring.`);
    return { outcome: "unknown_payment" };
  }

  const status = payload.payment_status;
  const isFinished = status === SUCCESS_STATUS;

  await updatePaymentFromIpn(payment.id, {
    status,
    payCurrency: payload.pay_currency ?? payment.payCurrency,
    payAmount: payload.pay_amount ?? payment.payAmount,
    // Set once, the first time this payment reaches "finished" — never
    // bumped forward on a repeat "finished" IPN, mirroring
    // lib/products/availability.ts's unavailableAt pattern.
    ...(isFinished && payment.completedAt == null ? { completedAt: new Date() } : {}),
  });

  let subscriptionActivated = false;
  if (isFinished) {
    const subscription = await activateSubscriptionForPayment(payment);
    subscriptionActivated = subscription !== null;
  }

  return { outcome: "processed", status, subscriptionActivated };
}
