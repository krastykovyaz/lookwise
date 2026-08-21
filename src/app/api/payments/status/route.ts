import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth/session";
import { getActiveSubscriptionForUser, getLatestPaymentForUser } from "@/lib/db/repositories/payments";

export const runtime = "nodejs";

// GET /api/payments/status — Step 3 section 5: "a small authenticated
// endpoint for the current user's latest/pending payment status" — the
// existing backend (Step 1/2) had no read path for this at all, only
// create + IPN. The frontend polls this while a payment is pending
// (see profile/subscription/page.tsx); it never creates or mutates
// anything, so polling it repeatedly is always safe. Always scoped to
// the authenticated caller (section 8) — never accepts a userId,
// paymentId, or anything else from the client to look up someone
// else's state.
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const [subscription, payment] = await Promise.all([
      getActiveSubscriptionForUser(userId),
      getLatestPaymentForUser(userId),
    ]);

    return NextResponse.json({
      subscription: subscription
        ? {
            status: subscription.status,
            startedAt: subscription.startedAt,
            expiresAt: subscription.expiresAt,
          }
        : null,
      payment: payment
        ? {
            status: payment.status,
            priceAmount: payment.priceAmount,
            priceCurrency: payment.priceCurrency,
            payCurrency: payment.payCurrency,
            payAmount: payment.payAmount,
            paymentUrl: payment.paymentUrl,
            createdAt: payment.createdAt,
          }
        : null,
    });
  } catch (err) {
    console.error("[GET /api/payments/status] failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
