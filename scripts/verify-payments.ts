// Exercises the NOWPayments Step 2 payment/subscription flow against a
// real, freshly migrated temporary SQLite database (not mocked, never
// the real dev.db) — NOWPayments' own API is mocked via
// createSubscriptionPayment's dependency-injection parameter (section
// 6: "do not perform real production payments during tests... use
// mocks/fixtures"). Run with `npm run verify:payments`.
//
// DATABASE_URL is pointed at a temp file *before* importing
// lib/db/client (and anything that transitively imports it), so every
// module in this process shares one connection to the throwaway
// database — same pattern as verify-auth.ts / verify-notifications.ts.

import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import crypto from "node:crypto";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "compass-payments-verify-"));
const dbPath = path.join(dir, "test.db");
process.env.DATABASE_URL = `file:${dbPath}`;
// verifyIpnSignature needs a real secret to compute against — never the
// real deployment's, a throwaway one for this process only.
process.env.NOWPAYMENTS_IPN_SECRET = "test-ipn-secret-do-not-use-in-prod";
process.env.NOWPAYMENTS_API_KEY = "test-api-key-do-not-use-in-prod";
// absoluteUrl() (used to build the IPN callback URL) falls back to
// Next.js's headers() when this isn't set, which requires a live
// request context this standalone script doesn't have.
process.env.NEXT_PUBLIC_APP_URL = "https://lookwise.test";

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${name}`);
  }
}

// Signs a payload exactly the way a real NOWPayments IPN would, using
// this test's own IPN secret — lets the test send a genuinely
// signature-valid request through the real verifyIpnSignature function.
function signPayload(body: unknown, secret: string): string {
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
  const sorted = JSON.stringify(sortKeysDeep(body));
  return crypto.createHmac("sha512", secret).update(sorted).digest("hex");
}

async function main() {
  const { db, schema } = await import("../src/lib/db/client");
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const { eq } = await import("drizzle-orm");
  const { createSubscriptionPayment } = await import("../src/lib/payments/nowpayments/checkout");
  const { processIpnEvent } = await import("../src/lib/payments/nowpayments/webhook");
  const { verifyIpnSignature } = await import("../src/lib/payments/nowpayments/ipn");
  const { activateSubscriptionForPayment, getActiveSubscriptionForUser, createPaymentRecord } = await import(
    "../src/lib/db/repositories/payments"
  );
  const { SUBSCRIPTION_PRICE_AMOUNT, SUBSCRIPTION_PRICE_CURRENCY, PREFERRED_PAY_CURRENCY } = await import(
    "../src/lib/payments/pricing"
  );

  migrate(db, { migrationsFolder: path.join(__dirname, "..", "drizzle") });

  // --- Structural checks: auth/signature guards run before business logic ---
  const createRouteSource = readFileSync(
    path.join(__dirname, "..", "src", "app", "api", "payments", "create", "route.ts"),
    "utf8",
  );
  check(
    "create route checks getSessionUserId() and 401s before calling createSubscriptionPayment",
    /getSessionUserId\(\)/.test(createRouteSource) &&
      /if \(!userId\) return NextResponse\.json\(\{ error: "unauthorized" \}, \{ status: 401 \}\);/.test(
        createRouteSource,
      ) &&
      createRouteSource.indexOf("getSessionUserId()") < createRouteSource.indexOf("createSubscriptionPayment("),
  );
  check(
    "create route never reads a request body (nothing for a client to override)",
    !/request\.json\(\)/.test(createRouteSource) && /export async function POST\(\)/.test(createRouteSource),
  );

  const ipnRouteSource = readFileSync(
    path.join(__dirname, "..", "src", "app", "api", "payments", "ipn", "route.ts"),
    "utf8",
  );
  check(
    "IPN route verifies the signature and 401s before calling processIpnEvent",
    /verifyIpnSignature\(rawBody, signature\)/.test(ipnRouteSource) &&
      ipnRouteSource.indexOf("verifyIpnSignature(") < ipnRouteSource.indexOf("processIpnEvent("),
  );

  // --- User fixtures ---------------------------------------------------
  const [userA] = await db.insert(schema.users).values({ email: "a@example.com" }).returning();
  const [userB] = await db.insert(schema.users).values({ email: "b@example.com" }).returning();

  // --- Authenticated payment creation + fixed price/currency -----------
  let capturedCreateInput: unknown = null;
  const fakePaymentId = "np-" + crypto.randomUUID();
  const fakeDeps = {
    createPayment: async (input: unknown) => {
      capturedCreateInput = input;
      return {
        payment_id: fakePaymentId,
        payment_status: "waiting",
        pay_address: "TFakeAddressXXXXXXXXXXXXXXXXXXXXXX",
        price_amount: 1,
        price_currency: "eur",
        pay_amount: 1.05,
        pay_currency: "usdttrc20",
        order_id: (input as { order_id: string }).order_id,
        order_description: "Lookwise subscription",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    },
    getSupportedCurrencies: async () => ({ currencies: ["usdttrc20", "btc", "eth"] }),
  };

  const view = await createSubscriptionPayment(userA.id, fakeDeps);
  check("createSubscriptionPayment returns the created payment's id", view.paymentId === fakePaymentId);
  check("returned view exposes only frontend-needed fields", Object.keys(view).sort().join(",") === [
    "payAddress",
    "payAmount",
    "payCurrency",
    "paymentId",
    "priceAmount",
    "priceCurrency",
    "status",
  ].sort().join(","));

  check(
    "€1 price cannot be overridden — the actual NOWPayments call always used the fixed constants",
    (capturedCreateInput as { price_amount: number })?.price_amount === SUBSCRIPTION_PRICE_AMOUNT &&
      (capturedCreateInput as { price_currency: string })?.price_currency === SUBSCRIPTION_PRICE_CURRENCY &&
      SUBSCRIPTION_PRICE_AMOUNT === 1 &&
      SUBSCRIPTION_PRICE_CURRENCY === "eur",
  );
  check(
    "USDT TRC20 preferred as pay_currency",
    (capturedCreateInput as { pay_currency: string })?.pay_currency === PREFERRED_PAY_CURRENCY &&
      PREFERRED_PAY_CURRENCY === "usdttrc20",
  );

  const [persisted] = await db.select().from(schema.payments).where(eq(schema.payments.userId, userA.id));
  check("payment row persisted with the userId", persisted?.userId === userA.id);
  check("payment row persisted with fixed price fields", persisted?.priceAmount === 1 && persisted?.priceCurrency === "eur");
  check("payment row status matches the created payment's initial status", persisted?.status === "waiting");

  // --- Duplicate in-flight payment prevention ---------------------------
  let secondCallHitNowPayments = false;
  const secondView = await createSubscriptionPayment(userA.id, {
    ...fakeDeps,
    createPayment: async (input: unknown) => {
      secondCallHitNowPayments = true;
      return fakeDeps.createPayment(input);
    },
  });
  check("a second create call for the same user reuses the existing in-flight payment", secondView.paymentId === fakePaymentId);
  check("reusing an in-flight payment never calls NOWPayments again", !secondCallHitNowPayments);
  const allPaymentsForA = await db.select().from(schema.payments).where(eq(schema.payments.userId, userA.id));
  check("no duplicate payment row was created", allPaymentsForA.length === 1);

  // --- IPN signature verification ---------------------------------------
  const ipnSecret = process.env.NOWPAYMENTS_IPN_SECRET!;
  const validPayload = { payment_id: fakePaymentId, payment_status: "finished", pay_currency: "usdttrc20", pay_amount: 1.05 };
  const validSig = signPayload(validPayload, ipnSecret);
  check("valid IPN signature is accepted", verifyIpnSignature(validPayload, validSig));
  check("tampered payload with the old signature is rejected", !verifyIpnSignature({ ...validPayload, payment_status: "failed" }, validSig));
  check("missing signature header is rejected", !verifyIpnSignature(validPayload, null));
  check("garbage signature is rejected", !verifyIpnSignature(validPayload, "not-a-real-signature"));

  // --- partially_paid must NOT activate the subscription -----------------
  const partialResult = await processIpnEvent({
    payment_id: fakePaymentId,
    payment_status: "partially_paid",
    pay_currency: "usdttrc20",
    pay_amount: 0.5,
  });
  check("partially_paid IPN is processed", partialResult.outcome === "processed");
  check("partially_paid does NOT activate a subscription", (partialResult as { subscriptionActivated: boolean }).subscriptionActivated === false);
  check("no subscription exists yet for user A", (await getActiveSubscriptionForUser(userA.id)) === null);

  // --- finished activates the subscription --------------------------------
  const finishedResult = await processIpnEvent({
    payment_id: fakePaymentId,
    payment_status: "finished",
    pay_currency: "usdttrc20",
    pay_amount: 1.05,
  });
  check("finished IPN activates the subscription", (finishedResult as { subscriptionActivated: boolean }).subscriptionActivated === true);
  const activeAfterFinish = await getActiveSubscriptionForUser(userA.id);
  check("user A now has an active subscription", activeAfterFinish !== null);
  check("subscription references the payment", activeAfterFinish?.paymentId === persisted?.id);
  const [paymentAfterFinish] = await db.select().from(schema.payments).where(eq(schema.payments.id, persisted!.id));
  check("payment status updated to finished", paymentAfterFinish?.status === "finished");
  check("payment completedAt was set", paymentAfterFinish?.completedAt != null);

  // --- repeated finished IPN is idempotent ---------------------------------
  const firstCompletedAt = paymentAfterFinish?.completedAt?.getTime();
  const repeatResult = await processIpnEvent({
    payment_id: fakePaymentId,
    payment_status: "finished",
    pay_currency: "usdttrc20",
    pay_amount: 1.05,
  });
  check("repeated finished IPN is processed without error", repeatResult.outcome === "processed");
  check(
    "repeated finished IPN does NOT activate a second subscription",
    (repeatResult as { subscriptionActivated: boolean }).subscriptionActivated === false,
  );
  const subsForA = await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.userId, userA.id));
  check("still exactly one subscription for user A after the repeat", subsForA.length === 1);
  const [paymentAfterRepeat] = await db.select().from(schema.payments).where(eq(schema.payments.id, persisted!.id));
  check("completedAt is not bumped forward on a repeat finished IPN", paymentAfterRepeat?.completedAt?.getTime() === firstCompletedAt);

  // --- failed / expired do not activate a subscription ---------------------
  const failedPaymentId = "np-" + crypto.randomUUID();
  await createPaymentRecord({
    id: crypto.randomUUID(),
    userId: userB.id,
    providerPaymentId: failedPaymentId,
    orderId: crypto.randomUUID(),
    priceAmount: 1,
    priceCurrency: "eur",
    status: "waiting",
  });
  const failedResult = await processIpnEvent({ payment_id: failedPaymentId, payment_status: "failed" });
  check("failed IPN does not activate a subscription", (failedResult as { subscriptionActivated: boolean }).subscriptionActivated === false);
  check("user B has no active subscription after a failed payment", (await getActiveSubscriptionForUser(userB.id)) === null);

  const expiredPaymentId = "np-" + crypto.randomUUID();
  await createPaymentRecord({
    id: crypto.randomUUID(),
    userId: userB.id,
    providerPaymentId: expiredPaymentId,
    orderId: crypto.randomUUID(),
    priceAmount: 1,
    priceCurrency: "eur",
    status: "waiting",
  });
  const expiredResult = await processIpnEvent({ payment_id: expiredPaymentId, payment_status: "expired" });
  check("expired IPN does not activate a subscription", (expiredResult as { subscriptionActivated: boolean }).subscriptionActivated === false);

  // --- unknown payment_id is handled gracefully -----------------------------
  const unknownResult = await processIpnEvent({ payment_id: "does-not-exist", payment_status: "finished" });
  check("IPN for an unrecognized payment_id is reported, not thrown", unknownResult.outcome === "unknown_payment");

  // --- duplicate active subscription prevention -----------------------------
  // userB gets a second finished payment while having no subscription yet —
  // should succeed normally first...
  const bPaymentId1 = "np-" + crypto.randomUUID();
  const bPayment1 = await createPaymentRecord({
    id: crypto.randomUUID(),
    userId: userB.id,
    providerPaymentId: bPaymentId1,
    orderId: crypto.randomUUID(),
    priceAmount: 1,
    priceCurrency: "eur",
    status: "waiting",
  });
  const firstActivation = await activateSubscriptionForPayment(bPayment1);
  check("first activation for user B succeeds", firstActivation !== null);

  // ...then a SECOND, entirely different finished payment for the same
  // user must not create a second active subscription.
  const bPaymentId2 = "np-" + crypto.randomUUID();
  const bPayment2 = await createPaymentRecord({
    id: crypto.randomUUID(),
    userId: userB.id,
    providerPaymentId: bPaymentId2,
    orderId: crypto.randomUUID(),
    priceAmount: 1,
    priceCurrency: "eur",
    status: "waiting",
  });
  const secondActivation = await activateSubscriptionForPayment(bPayment2);
  check("second activation attempt for an already-subscribed user is a no-op", secondActivation === null);
  const subsForB = await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.userId, userB.id));
  check("user B still has exactly one subscription", subsForB.length === 1);

  // --- NOWPayments payment id must be unique --------------------------------
  let uniqueConstraintHeld = false;
  try {
    await createPaymentRecord({
      id: crypto.randomUUID(),
      userId: userA.id,
      providerPaymentId: fakePaymentId, // already used above
      orderId: crypto.randomUUID(),
      priceAmount: 1,
      priceCurrency: "eur",
      status: "waiting",
    });
  } catch {
    uniqueConstraintHeld = true;
  }
  check("a duplicate NOWPayments payment_id cannot be persisted twice", uniqueConstraintHeld);

  rmSync(dir, { recursive: true, force: true });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
