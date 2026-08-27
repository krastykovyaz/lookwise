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
  const { createSubscriptionPayment, SubscriptionPriceBelowMinimumError } = await import(
    "../src/lib/payments/nowpayments/checkout"
  );
  const { processIpnEvent } = await import("../src/lib/payments/nowpayments/webhook");
  const { verifyIpnSignature } = await import("../src/lib/payments/nowpayments/ipn");
  const {
    activateSubscriptionForPayment,
    getActiveSubscriptionForUser,
    createPaymentRecord,
    getPaymentByProviderPaymentId,
    markSubscriptionExpired,
    getLatestPaymentForUser,
    isStaleInFlight,
    STALE_IN_FLIGHT_DISPLAY_WINDOW_MS,
  } = await import("../src/lib/db/repositories/payments");
  const { SUBSCRIPTION_PRICE_AMOUNT, SUBSCRIPTION_PRICE_CURRENCY, PREFERRED_PAY_CURRENCY } = await import(
    "../src/lib/payments/pricing"
  );
  const { resolveSubscriptionViewState, shouldContinuePolling } = await import("../src/lib/payments/viewState");
  const { getUserSubscription, isSubscriptionActive, requireActiveSubscription, SubscriptionRequiredError } =
    await import("../src/lib/payments/entitlement");

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

  const statusRouteSource = readFileSync(
    path.join(__dirname, "..", "src", "app", "api", "payments", "status", "route.ts"),
    "utf8",
  );
  check(
    "status route checks getSessionUserId() and 401s before reading any payment/subscription data",
    /getSessionUserId\(\)/.test(statusRouteSource) &&
      /if \(!userId\) return NextResponse\.json\(\{ error: "unauthorized" \}, \{ status: 401 \}\);/.test(
        statusRouteSource,
      ) &&
      statusRouteSource.indexOf("const userId = await getSessionUserId();") <
        statusRouteSource.indexOf("getUserSubscription(userId)"),
  );

  // --- Structural checks: subscription page (UI-level requirements that
  // don't fit a pure function — this project has no React rendering test
  // harness, so these are verified the same way verify-explore-
  // pagination.ts checks ExploreFeed.tsx: asserting the actual guard/
  // behavior is present in source, not just trusting a description). ---
  const subscriptionPageSource = readFileSync(
    path.join(__dirname, "..", "src", "app", "profile", "subscription", "page.tsx"),
    "utf8",
  );
  check(
    "subscribe handler guards against double-click (checks isCreating before doing anything)",
    /if \(isCreating\) return;/.test(subscriptionPageSource),
  );
  check(
    "payment creation calls the existing POST /api/payments/create with no request body",
    /fetch\("\/api\/payments\/create", \{ method: "POST" \}\)/.test(subscriptionPageSource),
  );
  check(
    "successful payment creation navigates externally to the returned URL, not an iframe",
    /window\.location\.href = json\.payment\.paymentUrl;/.test(subscriptionPageSource) &&
      !/<iframe/i.test(subscriptionPageSource),
  );
  check(
    "a loading state is shown before the first status fetch resolves",
    /loadState === "loading"/.test(subscriptionPageSource),
  );
  check(
    "unauthenticated users see a sign-in prompt, not a payments fetch",
    /sessionStatus === "unauthenticated"/.test(subscriptionPageSource) &&
      /href="\/login"/.test(subscriptionPageSource),
  );
  check(
    "polling is bounded by both a max duration and teardown on unmount/inactive",
    /MAX_POLL_DURATION_MS/.test(subscriptionPageSource) &&
      /clearInterval/.test(subscriptionPageSource) &&
      /return \(\) => clearInterval\(interval\);/.test(subscriptionPageSource),
  );
  check(
    "polling never calls the create-payment endpoint (status only)",
    (() => {
      const pollingEffectMatch = subscriptionPageSource.match(
        /useEffect\(\(\) => \{\s*if \(!pollingActive\)[\s\S]*?\}, \[pollingActive\]\);/,
      );
      return !!pollingEffectMatch && !pollingEffectMatch[0].includes("/api/payments/create");
    })(),
  );

  // --- Pure state-resolution logic (lib/payments/viewState.ts) ----------
  // Covers section 10's UI-facing scenarios without needing a rendering
  // harness: every "given this backend status, what should the page
  // show / should it keep polling" case is a plain function call.
  check(
    "no subscription, no payment -> 'none' (shows the Subscribe for €1 card)",
    resolveSubscriptionViewState(null).kind === "none",
  );
  check(
    "active subscription -> 'active' with the expiry date, regardless of any payment status",
    (() => {
      const state = resolveSubscriptionViewState({
        subscription: { status: "active", expiresAt: "2026-01-31T00:00:00.000Z" },
        payment: { status: "finished", paymentUrl: null },
      });
      return state.kind === "active" && (state as { expiresAt: string }).expiresAt === "2026-01-31T00:00:00.000Z";
    })(),
  );
  check(
    "subscription status 'expired' (entitlement layer already resolved it) -> 'subscription_expired', offers Renew",
    (() => {
      const state = resolveSubscriptionViewState({
        subscription: { status: "expired", expiresAt: "2026-01-01T00:00:00.000Z" },
        payment: { status: "finished", paymentUrl: null },
      });
      return (
        state.kind === "subscription_expired" &&
        (state as { expiresAt: string }).expiresAt === "2026-01-01T00:00:00.000Z" &&
        !shouldContinuePolling(state)
      );
    })(),
  );
  for (const pendingStatus of ["waiting", "confirming", "confirmed", "sending", "finished"]) {
    check(
      `payment status "${pendingStatus}" with no active subscription yet -> 'pending' (keeps polling)`,
      resolveSubscriptionViewState({ subscription: null, payment: { status: pendingStatus, paymentUrl: "https://x" } }).kind ===
        "pending",
    );
  }
  check(
    "partially_paid -> its own state, distinct from pending/terminal",
    resolveSubscriptionViewState({ subscription: null, payment: { status: "partially_paid", paymentUrl: "https://x" } }).kind ===
      "partially_paid",
  );
  for (const terminalStatus of ["failed", "expired", "refunded"]) {
    check(
      `payment status "${terminalStatus}" -> 'terminal' (stop polling, offer retry)`,
      (() => {
        const state = resolveSubscriptionViewState({ subscription: null, payment: { status: terminalStatus, paymentUrl: null } });
        return state.kind === "terminal" && (state as { status: string }).status === terminalStatus;
      })(),
    );
  }
  check(
    "polling continues for pending and partially_paid",
    shouldContinuePolling({ kind: "pending", status: "waiting", paymentUrl: null }) &&
      shouldContinuePolling({ kind: "partially_paid", paymentUrl: null }),
  );
  check(
    "polling stops for none/active/terminal",
    !shouldContinuePolling({ kind: "none" }) &&
      !shouldContinuePolling({ kind: "active", expiresAt: "2026-01-01T00:00:00.000Z" }) &&
      !shouldContinuePolling({ kind: "terminal", status: "failed" }),
  );

  // --- User fixtures ---------------------------------------------------
  const [userA] = await db.insert(schema.users).values({ email: "a@example.com" }).returning();
  const [userB] = await db.insert(schema.users).values({ email: "b@example.com" }).returning();

  // --- Authenticated payment creation + fixed price/currency -----------
  // (hosted-invoice flow, Step 3 — see checkout.ts's own doc for why
  // there is no real NOWPayments payment_id yet at this point, only an
  // invoice id placeholder + our own order_id)
  let capturedCreateInput: unknown = null;
  const fakeInvoiceId = "inv-" + crypto.randomUUID();
  const fakeInvoiceUrl = `https://nowpayments.io/payment/?iid=${fakeInvoiceId}`;
  const fakeDeps = {
    createInvoice: async (input: unknown) => {
      capturedCreateInput = input;
      return {
        id: fakeInvoiceId,
        order_id: (input as { order_id: string }).order_id,
        order_description: "Lookwise subscription",
        price_amount: SUBSCRIPTION_PRICE_AMOUNT,
        price_currency: SUBSCRIPTION_PRICE_CURRENCY,
        pay_currency: "usdtbsc",
        invoice_url: fakeInvoiceUrl,
        success_url: null,
        cancel_url: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    },
    getSupportedCurrencies: async () => ({ currencies: ["usdtbsc", "btc", "eth"] }),
    getMinAmount: async (currencyFrom: string, currencyTo: string) => ({
      currency_from: currencyFrom,
      currency_to: currencyTo,
      min_amount: SUBSCRIPTION_PRICE_AMOUNT - 0.5,
    }),
  };

  const view = await createSubscriptionPayment(userA.id, fakeDeps);
  check("createSubscriptionPayment returns a placeholder id referencing the invoice", view.paymentId === `invoice:${fakeInvoiceId}`);
  check("createSubscriptionPayment returns the hosted checkout URL", view.paymentUrl === fakeInvoiceUrl);
  check("returned view exposes only frontend-needed fields", Object.keys(view).sort().join(",") === [
    "payAmount",
    "payCurrency",
    "paymentId",
    "paymentUrl",
    "priceAmount",
    "priceCurrency",
    "status",
  ].sort().join(","));

  check(
    "fixed price cannot be overridden — the actual NOWPayments call always used the fixed constants",
    (capturedCreateInput as { price_amount: number })?.price_amount === SUBSCRIPTION_PRICE_AMOUNT &&
      (capturedCreateInput as { price_currency: string })?.price_currency === SUBSCRIPTION_PRICE_CURRENCY &&
      SUBSCRIPTION_PRICE_CURRENCY === "usdtbsc",
  );
  check(
    "USDT BSC (BEP20) preferred as pay_currency",
    (capturedCreateInput as { pay_currency: string })?.pay_currency === PREFERRED_PAY_CURRENCY &&
      PREFERRED_PAY_CURRENCY === "usdtbsc",
  );

  const [persisted] = await db.select().from(schema.payments).where(eq(schema.payments.userId, userA.id));
  check("payment row persisted with the userId", persisted?.userId === userA.id);
  check("payment row persisted with fixed price fields", persisted?.priceAmount === SUBSCRIPTION_PRICE_AMOUNT && persisted?.priceCurrency === SUBSCRIPTION_PRICE_CURRENCY);
  check("payment row status matches the created payment's initial status", persisted?.status === "waiting");
  check("payment row persisted the checkout URL", persisted?.paymentUrl === fakeInvoiceUrl);
  const orderIdForA = persisted!.orderId;

  // --- Duplicate in-flight payment prevention ---------------------------
  let secondCallHitNowPayments = false;
  const secondView = await createSubscriptionPayment(userA.id, {
    ...fakeDeps,
    createInvoice: async (input: unknown) => {
      secondCallHitNowPayments = true;
      return fakeDeps.createInvoice(input);
    },
  });
  check("a second create call for the same user reuses the existing in-flight payment", secondView.paymentId === view.paymentId);
  check("reusing an in-flight payment never calls NOWPayments again", !secondCallHitNowPayments);
  check("reusing an in-flight payment returns the same checkout URL", secondView.paymentUrl === fakeInvoiceUrl);
  const allPaymentsForA = await db.select().from(schema.payments).where(eq(schema.payments.userId, userA.id));
  check("no duplicate payment row was created", allPaymentsForA.length === 1);

  // --- Minimum-amount gate: never hardcoded, always queried live from
  // NOWPayments before any invoice is created (section 3/4 of this
  // stage's spec — this is the exact mechanism the €1/USDT TRC20 price
  // was silently violating in production before this check existed). ---
  const [userMinGateAbove] = await db.insert(schema.users).values({ email: "min-gate-above@example.com" }).returning();
  const fakeInvoiceIdForMinGate = "inv-" + crypto.randomUUID();
  const fakeInvoiceUrlForMinGate = `https://nowpayments.io/payment/?iid=${fakeInvoiceIdForMinGate}`;
  let minAmountArgsAbove: [string, string] | null = null;
  const viewAboveMin = await createSubscriptionPayment(userMinGateAbove.id, {
    ...fakeDeps,
    createInvoice: async (input: unknown) => ({
      id: fakeInvoiceIdForMinGate,
      order_id: (input as { order_id: string }).order_id,
      order_description: "Lookwise subscription",
      price_amount: SUBSCRIPTION_PRICE_AMOUNT,
      price_currency: SUBSCRIPTION_PRICE_CURRENCY,
      pay_currency: "usdtbsc",
      invoice_url: fakeInvoiceUrlForMinGate,
      success_url: null,
      cancel_url: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }),
    getMinAmount: async (currencyFrom: string, currencyTo: string) => {
      minAmountArgsAbove = [currencyFrom, currencyTo];
      return { currency_from: currencyFrom, currency_to: currencyTo, min_amount: SUBSCRIPTION_PRICE_AMOUNT - 0.5 };
    },
  });
  check(
    "min-amount is queried for the exact fixed price-currency -> pay-currency pair",
    minAmountArgsAbove !== null &&
      (minAmountArgsAbove as [string, string])[0] === SUBSCRIPTION_PRICE_CURRENCY &&
      (minAmountArgsAbove as [string, string])[1] === PREFERRED_PAY_CURRENCY,
  );
  check("price above the live minimum -> invoice is created normally", viewAboveMin.paymentId === `invoice:${fakeInvoiceIdForMinGate}`);

  const [userMinGateBelow] = await db.insert(schema.users).values({ email: "min-gate-below@example.com" }).returning();
  let createInvoiceCalledForBelowMin = false;
  let belowMinError: unknown = null;
  try {
    await createSubscriptionPayment(userMinGateBelow.id, {
      ...fakeDeps,
      createInvoice: async (input: unknown) => {
        createInvoiceCalledForBelowMin = true;
        return fakeDeps.createInvoice(input);
      },
      getMinAmount: async (currencyFrom: string, currencyTo: string) => ({
        currency_from: currencyFrom,
        currency_to: currencyTo,
        min_amount: SUBSCRIPTION_PRICE_AMOUNT + 15.5,
      }),
    });
  } catch (err) {
    belowMinError = err;
  }
  check("price below the live minimum throws SubscriptionPriceBelowMinimumError", belowMinError instanceof SubscriptionPriceBelowMinimumError);
  check(
    "the thrown error carries the live minimum that was actually returned",
    (belowMinError as InstanceType<typeof SubscriptionPriceBelowMinimumError> | null)?.minAmount === SUBSCRIPTION_PRICE_AMOUNT + 15.5,
  );
  check("createInvoice is never called when the price is below the minimum", !createInvoiceCalledForBelowMin);
  const paymentsForBelowMinUser = await db
    .select()
    .from(schema.payments)
    .where(eq(schema.payments.userId, userMinGateBelow.id));
  check("no payment row is persisted when the price is below the minimum", paymentsForBelowMinUser.length === 0);

  // --- IPN signature verification ---------------------------------------
  const ipnSecret = process.env.NOWPAYMENTS_IPN_SECRET!;
  const realPaymentIdForA = "np-real-" + crypto.randomUUID();
  const validPayload = { payment_id: realPaymentIdForA, payment_status: "finished", pay_currency: "usdttrc20", pay_amount: 1.05, order_id: orderIdForA };
  const validSig = signPayload(validPayload, ipnSecret);
  check("valid IPN signature is accepted", verifyIpnSignature(validPayload, validSig));
  check("tampered payload with the old signature is rejected", !verifyIpnSignature({ ...validPayload, payment_status: "failed" }, validSig));
  check("missing signature header is rejected", !verifyIpnSignature(validPayload, null));
  check("garbage signature is rejected", !verifyIpnSignature(validPayload, "not-a-real-signature"));


  // --- partially_paid must NOT activate the subscription -----------------
  // This is also the FIRST IPN for this payment — providerPaymentId is
  // still the invoice placeholder, so this exercises the order_id
  // fallback matching (webhook.ts) that upgrades it to the real
  // payment_id.
  const partialResult = await processIpnEvent({
    payment_id: realPaymentIdForA,
    payment_status: "partially_paid",
    pay_currency: "usdttrc20",
    pay_amount: 0.5,
    order_id: orderIdForA,
  });
  check("partially_paid IPN is processed", partialResult.outcome === "processed");
  check("partially_paid does NOT activate a subscription", (partialResult as { subscriptionActivated: boolean }).subscriptionActivated === false);
  check("no subscription exists yet for user A", (await getActiveSubscriptionForUser(userA.id)) === null);
  const upgradedRow = await getPaymentByProviderPaymentId(realPaymentIdForA);
  check("order_id fallback upgraded the placeholder to the real payment_id", upgradedRow?.id === persisted!.id);

  // --- finished activates the subscription --------------------------------
  // Now matches directly via providerPaymentId (already upgraded above).
  const finishedResult = await processIpnEvent({
    payment_id: realPaymentIdForA,
    payment_status: "finished",
    pay_currency: "usdttrc20",
    pay_amount: 1.05,
    order_id: orderIdForA,
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
    payment_id: realPaymentIdForA,
    payment_status: "finished",
    pay_currency: "usdttrc20",
    pay_amount: 1.05,
    order_id: orderIdForA,
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
      providerPaymentId: realPaymentIdForA, // already used above (upgraded onto user A's payment row)
      orderId: crypto.randomUUID(),
      priceAmount: 1,
      priceCurrency: "eur",
      status: "waiting",
    });
  } catch {
    uniqueConstraintHeld = true;
  }
  check("a duplicate NOWPayments payment_id cannot be persisted twice", uniqueConstraintHeld);

  // ==========================================================================
  // Subscription entitlements (lib/payments/entitlement.ts) — the single
  // server-side source of truth this stage adds.
  // ==========================================================================

  // --- active subscription -> entitlement true -----------------------------
  // User A already has a genuinely active subscription from earlier in
  // this run (the "finished IPN activates the subscription" section).
  check("active subscription -> getUserSubscription reports 'active'", (await getUserSubscription(userA.id)).status === "active");
  check("active subscription -> isSubscriptionActive is true", await isSubscriptionActive(userA.id));

  // --- expiresAt in the past -> entitlement false (even though the DB
  // status column still says 'active' — nothing has swept it) -----------
  const [userE] = await db.insert(schema.users).values({ email: "e@example.com" }).returning();
  const pastExpiry = new Date(Date.now() - 24 * 60 * 60 * 1000); // yesterday
  const expiredPaymentForE = await createPaymentRecord({
    id: crypto.randomUUID(),
    userId: userE.id,
    providerPaymentId: "np-real-" + crypto.randomUUID(),
    orderId: crypto.randomUUID(),
    priceAmount: 1,
    priceCurrency: "eur",
    status: "finished",
  });
  await db.insert(schema.subscriptions).values({
    userId: userE.id,
    status: "active", // DB says active...
    startedAt: new Date(pastExpiry.getTime() - 30 * 24 * 60 * 60 * 1000),
    expiresAt: pastExpiry, // ...but expiresAt is in the past
    paymentId: expiredPaymentForE.id,
  });
  check(
    "expiresAt in the past -> getUserSubscription reports 'expired', not 'active', with NO client refresh/hack needed (plain read)",
    (await getUserSubscription(userE.id)).status === "expired",
  );
  check("expiresAt in the past -> isSubscriptionActive is false", !(await isSubscriptionActive(userE.id)));

  // --- inactive (explicitly non-active status) subscription -> entitlement false ---
  const [userF] = await db.insert(schema.users).values({ email: "f@example.com" }).returning();
  const inactivePaymentForF = await createPaymentRecord({
    id: crypto.randomUUID(),
    userId: userF.id,
    providerPaymentId: "np-real-" + crypto.randomUUID(),
    orderId: crypto.randomUUID(),
    priceAmount: 1,
    priceCurrency: "eur",
    status: "finished",
  });
  const [canceledSub] = await db
    .insert(schema.subscriptions)
    .values({
      userId: userF.id,
      status: "active",
      startedAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      paymentId: inactivePaymentForF.id,
    })
    .returning();
  await markSubscriptionExpired(canceledSub.id);
  check("subscription explicitly marked non-active -> entitlement false", !(await isSubscriptionActive(userF.id)));

  // --- no subscription at all -> entitlement false --------------------------
  const [userG] = await db.insert(schema.users).values({ email: "g@example.com" }).returning();
  check("no subscription -> getUserSubscription reports 'none'", (await getUserSubscription(userG.id)).status === "none");
  check("no subscription -> isSubscriptionActive is false", !(await isSubscriptionActive(userG.id)));

  // --- unauthenticated -> entitlement false, never treated as an active subscriber ---
  check("unauthenticated (null userId) -> getUserSubscription reports 'none'", (await getUserSubscription(null)).status === "none");
  check("unauthenticated (null userId) -> isSubscriptionActive is false", !(await isSubscriptionActive(null)));

  // --- protected server endpoint primitive: rejects inactive, accepts active ---
  let rejectedInactive = false;
  try {
    await requireActiveSubscription(userG.id); // never subscribed
  } catch (err) {
    rejectedInactive = err instanceof SubscriptionRequiredError;
  }
  check("requireActiveSubscription throws SubscriptionRequiredError for a non-subscriber", rejectedInactive);

  let rejectedExpired = false;
  try {
    await requireActiveSubscription(userE.id); // expired by time
  } catch (err) {
    rejectedExpired = err instanceof SubscriptionRequiredError;
  }
  check("requireActiveSubscription throws for an expired-by-time subscriber", rejectedExpired);

  let rejectedUnauthenticated = false;
  try {
    await requireActiveSubscription(null);
  } catch (err) {
    rejectedUnauthenticated = err instanceof SubscriptionRequiredError;
  }
  check("requireActiveSubscription throws for an unauthenticated caller", rejectedUnauthenticated);

  let acceptedActive = true;
  try {
    await requireActiveSubscription(userA.id); // genuinely active from earlier
  } catch {
    acceptedActive = false;
  }
  check("requireActiveSubscription does not throw for a genuinely active subscriber", acceptedActive);

  // --- renewal: an expired-by-time subscriber pays again -> gets a NEW
  // active subscription; the old row is no longer the active one -------
  const renewalPaymentId = "np-real-" + crypto.randomUUID();
  const renewalPayment = await createPaymentRecord({
    id: crypto.randomUUID(),
    userId: userE.id,
    providerPaymentId: renewalPaymentId,
    orderId: crypto.randomUUID(),
    priceAmount: 1,
    priceCurrency: "eur",
    status: "waiting",
  });
  const oldSubForE = await getActiveSubscriptionForUser(userE.id); // still DB-status 'active' (stale)
  const renewalActivation = await activateSubscriptionForPayment(renewalPayment);
  check("renewal for an expired-by-time subscriber succeeds (does not incorrectly no-op)", renewalActivation !== null);
  check("renewal creates a genuinely NEW subscription row", renewalActivation?.id !== oldSubForE?.id);
  check("after renewal, entitlement is active again", await isSubscriptionActive(userE.id));
  const [oldSubRowAfterRenewal] = await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.id, oldSubForE!.id));
  check("the old expired row was flipped away from 'active' (no longer blocks the partial unique index)", oldSubRowAfterRenewal.status !== "active");
  const allSubsForE = await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.userId, userE.id));
  check("user E has exactly one row with status='active' after renewal (partial unique index intact)", allSubsForE.filter((s) => s.status === "active").length === 1);

  // --- Stale in-flight payments must not permanently block Subscribe ------
  // Discovered in production: a "waiting" payment nobody ever completed
  // is forever the "latest payment" (getLatestPaymentForUser has no
  // staleness concept of its own, correctly) — but the frontend renders
  // ANY in-flight payment as "Continue Payment" pointing at that same
  // dead checkout URL, so an abandoned payment silently hid the fresh
  // Subscribe button from that user forever, regardless of any backend
  // pricing/currency change. isStaleInFlight (status route) is the fix.
  check(
    "a fresh in-flight payment is never considered stale",
    !isStaleInFlight({ status: "waiting", createdAt: new Date() }),
  );
  check(
    "an in-flight payment just under the staleness window is not yet stale",
    !isStaleInFlight({
      status: "waiting",
      createdAt: new Date(Date.now() - (STALE_IN_FLIGHT_DISPLAY_WINDOW_MS - 60_000)),
    }),
  );
  check(
    "an in-flight payment past the staleness window is stale",
    isStaleInFlight({
      status: "waiting",
      createdAt: new Date(Date.now() - (STALE_IN_FLIGHT_DISPLAY_WINDOW_MS + 60_000)),
    }),
  );
  for (const terminalStatus of ["finished", "failed", "expired", "refunded"]) {
    check(
      `a terminal ("${terminalStatus}") payment is never "stale in-flight" regardless of age — it's not in-flight at all`,
      !isStaleInFlight({ status: terminalStatus, createdAt: new Date(Date.now() - STALE_IN_FLIGHT_DISPLAY_WINDOW_MS * 10) }),
    );
  }

  // Integration-level: reproduces the exact production scenario — an
  // old abandoned "waiting" payment, days old, still sits as this
  // user's most recent row.
  const [userStalePayment] = await db.insert(schema.users).values({ email: "stale-payment@example.com" }).returning();
  await createPaymentRecord({
    id: crypto.randomUUID(),
    userId: userStalePayment.id,
    providerPaymentId: "np-stale-" + crypto.randomUUID(),
    orderId: crypto.randomUUID(),
    priceAmount: 1,
    priceCurrency: "eur",
    status: "waiting",
  });
  // Backdate it past the window directly (createPaymentRecord always
  // stamps "now" — there's no created-in-the-past API, nor should there
  // be one outside a test).
  const staleRow = await getLatestPaymentForUser(userStalePayment.id);
  await db
    .update(schema.payments)
    .set({ createdAt: new Date(Date.now() - STALE_IN_FLIGHT_DISPLAY_WINDOW_MS * 2) })
    .where(eq(schema.payments.id, staleRow!.id));
  const rebackdated = await getLatestPaymentForUser(userStalePayment.id);
  check(
    "getLatestPaymentForUser itself still returns the old row unfiltered (it's a plain 'most recent' read, by design)",
    rebackdated?.id === staleRow!.id,
  );
  check(
    "isStaleInFlight correctly flags that same row as stale once it's backdated past the window",
    isStaleInFlight(rebackdated!),
  );

  rmSync(dir, { recursive: true, force: true });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
