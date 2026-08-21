import { NextResponse } from "next/server";
import { verifyIpnSignature } from "@/lib/payments/nowpayments/ipn";
import { NowPaymentsConfigError } from "@/lib/payments/nowpayments/env";
import { processIpnEvent } from "@/lib/payments/nowpayments/webhook";
import { NowPaymentsIpnSchema } from "@/lib/schemas";

export const runtime = "nodejs";

// POST /api/payments/ipn — NOWPayments' webhook callback. This is the
// ONLY authentication this route has (section 3): there is no session,
// no user-supplied identity to trust — the x-nowpayments-sig header is
// the sole security boundary, checked against the complete raw body
// BEFORE it's narrowed by any schema (see NowPaymentsIpnSchema's own
// comment for why order matters here).
export async function POST(request: Request) {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const signature = request.headers.get("x-nowpayments-sig");
  try {
    if (!verifyIpnSignature(rawBody, signature)) {
      console.warn("[POST /api/payments/ipn] rejected: invalid or missing signature");
      return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
    }
  } catch (err) {
    if (err instanceof NowPaymentsConfigError) {
      // NOWPAYMENTS_IPN_SECRET isn't set — this is a deployment
      // mistake, not something a signature could ever satisfy. 503,
      // not 401: a missing config, not a rejected credential.
      return NextResponse.json({ error: "not_configured" }, { status: 503 });
    }
    throw err;
  }

  const parsed = NowPaymentsIpnSchema.safeParse(rawBody);
  if (!parsed.success) {
    console.error("[POST /api/payments/ipn] payload failed validation after signature check passed");
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  try {
    const result = await processIpnEvent(parsed.data);
    // 200 even for an unrecognized payment_id — logged server-side
    // already (processIpnEvent), and a non-2xx here just makes
    // NOWPayments retry something this app will never recognize.
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[POST /api/payments/ipn] processing failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
