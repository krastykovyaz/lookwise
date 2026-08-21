import "server-only";
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { computeSubscriptionExpiry } from "@/lib/payments/subscription";

export type PaymentRow = typeof schema.payments.$inferSelect;
export type SubscriptionRow = typeof schema.subscriptions.$inferSelect;

// Statuses where a payment is still "in flight" — not yet resolved one
// way or the other. Used both to find a reusable pending payment
// (section 2: "prevent duplicate active/pending payment creation") and,
// by exclusion, to know finished/failed/expired/refunded are terminal.
const IN_FLIGHT_STATUSES = ["waiting", "confirming", "confirmed", "sending", "partially_paid"] as const;

// How long a "waiting" payment is still considered reusable before a
// fresh payment-creation request gets a brand new one instead. Past
// this window the old one is presumed abandoned (the user never sent
// funds) rather than still in progress. A named constant, not a magic
// number, per the same "easy to change later" spirit as the
// subscription duration.
const IN_FLIGHT_REUSE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

/** The most recent still-in-flight payment for this user, if any and if
 *  recent enough to still be worth reusing rather than creating a new
 *  one. Returns null when there's nothing to reuse — the caller should
 *  create a fresh payment in that case. */
export async function findReusableInFlightPayment(userId: string): Promise<PaymentRow | null> {
  const cutoff = new Date(Date.now() - IN_FLIGHT_REUSE_WINDOW_MS);
  const [row] = await db
    .select()
    .from(schema.payments)
    .where(
      and(
        eq(schema.payments.userId, userId),
        inArray(schema.payments.status, IN_FLIGHT_STATUSES),
        gt(schema.payments.createdAt, cutoff),
      ),
    )
    .orderBy(desc(schema.payments.createdAt))
    .limit(1);
  return row ?? null;
}

export interface CreatePaymentRecordInput {
  id: string;
  userId: string;
  providerPaymentId: string;
  orderId: string;
  priceAmount: number;
  priceCurrency: string;
  payCurrency?: string | null;
  payAmount?: number | null;
  payAddress?: string | null;
  paymentUrl?: string | null;
  status: string;
}

/** Persists a payment BEFORE the create-payment endpoint ever returns
 *  success (section 2) — this is the durable record an IPN will later
 *  be matched against by providerPaymentId. `id` is supplied by the
 *  caller (generated before calling NOWPayments, reused as their
 *  order_id) rather than left to the column default, so the same value
 *  correlates the local row, the NOWPayments order_id, and — via the
 *  orderId unique index — protects against a retried request that
 *  reached NOWPayments once already from inserting a second row. */
export async function createPaymentRecord(input: CreatePaymentRecordInput): Promise<PaymentRow> {
  const [row] = await db
    .insert(schema.payments)
    .values({
      id: input.id,
      userId: input.userId,
      providerPaymentId: input.providerPaymentId,
      orderId: input.orderId,
      priceAmount: input.priceAmount,
      priceCurrency: input.priceCurrency,
      payCurrency: input.payCurrency ?? null,
      payAmount: input.payAmount ?? null,
      payAddress: input.payAddress ?? null,
      paymentUrl: input.paymentUrl ?? null,
      status: input.status,
    })
    .returning();
  return row;
}

export async function getPaymentByProviderPaymentId(
  providerPaymentId: string,
  provider = "nowpayments",
): Promise<PaymentRow | null> {
  const [row] = await db
    .select()
    .from(schema.payments)
    .where(and(eq(schema.payments.provider, provider), eq(schema.payments.providerPaymentId, providerPaymentId)));
  return row ?? null;
}

/** Step 3's invoice-based checkout (lib/payments/nowpayments/checkout.ts)
 *  doesn't have a real NOWPayments payment_id at creation time — only
 *  our own orderId, which IS known up front and is echoed back in every
 *  IPN for that payment. webhook.ts falls back to this when
 *  getPaymentByProviderPaymentId finds nothing, to locate the row a
 *  placeholder providerPaymentId was created with. */
export async function getPaymentByOrderId(orderId: string): Promise<PaymentRow | null> {
  const [row] = await db.select().from(schema.payments).where(eq(schema.payments.orderId, orderId));
  return row ?? null;
}

/** "Upgrades" a payment row created with a placeholder providerPaymentId
 *  (the NOWPayments invoice id — unique, but not the real payment id) to
 *  the real payment_id NOWPayments only reveals via the first IPN for
 *  that payment. Every later IPN for the same payment then matches
 *  directly via getPaymentByProviderPaymentId, no fallback needed. */
export async function linkProviderPaymentId(paymentRowId: string, providerPaymentId: string): Promise<PaymentRow> {
  const [row] = await db
    .update(schema.payments)
    .set({ providerPaymentId, updatedAt: new Date() })
    .where(eq(schema.payments.id, paymentRowId))
    .returning();
  return row;
}

/** The user's single most recent payment, regardless of status —
 *  backs GET /api/payments/status (Step 3 section 5), which the
 *  frontend polls while a payment is pending. Not scoped to in-flight
 *  statuses (unlike findReusableInFlightPayment above) since the
 *  status endpoint also needs to report a just-finished/failed/expired
 *  outcome, not only "still pending". */
export async function getLatestPaymentForUser(userId: string): Promise<PaymentRow | null> {
  const [row] = await db
    .select()
    .from(schema.payments)
    .where(eq(schema.payments.userId, userId))
    .orderBy(desc(schema.payments.createdAt))
    .limit(1);
  return row ?? null;
}

export interface UpdatePaymentFromIpnInput {
  status: string;
  payCurrency?: string | null;
  payAmount?: number | null;
  completedAt?: Date | null;
}

/** Always safe to call with the same status repeatedly — a plain
 *  UPDATE, not an insert, so this half of IPN idempotency needs no
 *  special-casing (see activateSubscriptionForPayment for the half
 *  that DOES need one: subscription creation). */
export async function updatePaymentFromIpn(paymentRowId: string, input: UpdatePaymentFromIpnInput): Promise<void> {
  await db
    .update(schema.payments)
    .set({
      status: input.status,
      payCurrency: input.payCurrency ?? undefined,
      payAmount: input.payAmount ?? undefined,
      updatedAt: new Date(),
      ...(input.completedAt !== undefined ? { completedAt: input.completedAt } : {}),
    })
    .where(eq(schema.payments.id, paymentRowId));
}

export async function getActiveSubscriptionForUser(userId: string): Promise<SubscriptionRow | null> {
  const [row] = await db
    .select()
    .from(schema.subscriptions)
    .where(and(eq(schema.subscriptions.userId, userId), eq(schema.subscriptions.status, "active")));
  return row ?? null;
}

function isUniqueConstraintError(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  if (code === "SQLITE_CONSTRAINT_UNIQUE" || code === "SQLITE_CONSTRAINT") return true;
  return /UNIQUE constraint failed/i.test((err as Error)?.message ?? "");
}

/** Idempotent via TWO partial/unique indexes (schema/domain.ts):
 *  `subscription_payment_uq` means the same payment can never activate
 *  a second subscription no matter how many times its "finished" IPN
 *  is replayed, and `subscription_user_active_uq` means a user who
 *  already has an active subscription never gets a second one (section
 *  4: "do not create duplicate active subscriptions"). SQLite's
 *  ON CONFLICT clause only catches a conflict on the exact index named
 *  as its target, so the user-active case is checked explicitly first
 *  — onConflictDoNothing alone would let that one through as an
 *  uncaught constraint-violation error instead of a clean no-op. The
 *  catch below is a defense-in-depth backstop for the (normally
 *  impossible, single-writer SQLite) race between that check and the
 *  insert. Returns the created row, or null when either guard skipped
 *  it. */
export async function activateSubscriptionForPayment(payment: PaymentRow): Promise<SubscriptionRow | null> {
  const existingActive = await getActiveSubscriptionForUser(payment.userId);
  if (existingActive) return null;

  const startedAt = new Date();
  try {
    const [row] = await db
      .insert(schema.subscriptions)
      .values({
        userId: payment.userId,
        status: "active",
        startedAt,
        expiresAt: computeSubscriptionExpiry(startedAt),
        paymentId: payment.id,
      })
      .onConflictDoNothing({ target: schema.subscriptions.paymentId })
      .returning();
    return row ?? null;
  } catch (err) {
    if (isUniqueConstraintError(err)) return null;
    throw err;
  }
}
