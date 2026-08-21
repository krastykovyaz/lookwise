import "server-only";
import crypto from "node:crypto";
import { getIpnSecret } from "@/lib/payments/nowpayments/env";

// Section 5 of the payments spec: "prepare the webhook/IPN
// configuration conceptually, but do NOT activate payment processing
// yet." This is that preparation — a pure, standalone signature-
// verification utility, not wired into any route. Nothing calls this
// yet; a later milestone's webhook handler (POST /api/webhooks/
// nowpayments or similar) will be the first real caller.

/** NOWPayments computes the IPN signature over the callback body with
 *  every object's keys sorted alphabetically (recursively, not just at
 *  the top level) before JSON-stringifying it. */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}

/** Verifies an IPN (webhook) callback's `x-nowpayments-sig` header
 *  against the parsed JSON body: HMAC-SHA512 over the key-sorted body,
 *  hex-encoded, per NOWPayments' documented IPN scheme. Returns false
 *  (never throws on a bad signature) for anything that doesn't match —
 *  only NowPaymentsConfigError propagates, if NOWPAYMENTS_IPN_SECRET
 *  isn't configured, since that's a deployment mistake, not an
 *  attacker-controlled input. */
export function verifyIpnSignature(body: unknown, signatureHeader: string | null | undefined): boolean {
  if (!signatureHeader) return false;

  const secret = getIpnSecret();
  const sortedBody = JSON.stringify(sortKeysDeep(body));
  const expectedHex = crypto.createHmac("sha512", secret).update(sortedBody).digest("hex");

  let expectedBuf: Buffer;
  let actualBuf: Buffer;
  try {
    expectedBuf = Buffer.from(expectedHex, "hex");
    actualBuf = Buffer.from(signatureHeader, "hex");
  } catch {
    return false;
  }
  // Constant-time comparison — a malformed/short header must not short-
  // circuit the length check into a timing signal either.
  if (expectedBuf.length !== actualBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}
