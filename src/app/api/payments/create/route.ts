import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth/session";
import { createSubscriptionPayment } from "@/lib/payments/nowpayments/checkout";
import { NowPaymentsConfigError } from "@/lib/payments/nowpayments/env";
import { NowPaymentsApiError } from "@/lib/payments/nowpayments/client";

export const runtime = "nodejs";

// POST /api/payments/create — authenticated only (section 2/5). No
// request body is ever read: price/currency/pay-currency are fixed
// server-side constants (lib/payments/pricing.ts), so there is nothing
// for a client to override even if it tried. Returns only what the
// frontend needs to open/continue the payment — never the raw
// NOWPayments response, never any credential.
export async function POST() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const payment = await createSubscriptionPayment(userId);
    return NextResponse.json({ payment });
  } catch (err) {
    if (err instanceof NowPaymentsConfigError) {
      return NextResponse.json(
        { error: "payments_not_configured", message: "Payments are not configured yet." },
        { status: 503 },
      );
    }
    if (err instanceof NowPaymentsApiError) {
      console.error("[POST /api/payments/create] NOWPayments error:", err.message);
      return NextResponse.json(
        { error: "payment_provider_error", message: "Could not create the payment. Please try again." },
        { status: 502 },
      );
    }
    console.error("[POST /api/payments/create] failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
