import "server-only";
import crypto from "node:crypto";
import {
  createInvoice as createNowPaymentsInvoice,
  getSupportedCurrencies as getNowPaymentsCurrencies,
  getMinAmount as getNowPaymentsMinAmount,
} from "@/lib/payments/nowpayments/client";
import {
  createPaymentRecord,
  findReusableInFlightPayment,
  type PaymentRow,
} from "@/lib/db/repositories/payments";
import { SUBSCRIPTION_PRICE_AMOUNT, SUBSCRIPTION_PRICE_CURRENCY, PREFERRED_PAY_CURRENCY } from "@/lib/payments/pricing";
import { absoluteUrl } from "@/lib/url";

/** Only the fields the frontend actually needs to open/continue a
 *  payment (section 2: "return only the data required by the
 *  frontend") — never the full NOWPayments response, never anything
 *  from our own DB row beyond this. No pay address/QR data: the whole
 *  point of the hosted-invoice flow (Step 3) is that NOWPayments' own
 *  page shows that, not us — see paymentUrl. */
export interface SubscriptionPaymentView {
  paymentId: string;
  status: string;
  priceAmount: number;
  priceCurrency: string;
  payCurrency: string | null;
  payAmount: number | null;
  paymentUrl: string | null;
}

/** Thrown when the fixed subscription price is below whatever minimum
 *  NOWPayments is currently enforcing for this currency pair — a real
 *  possibility since that minimum is their business/network decision,
 *  not ours, and it can change without notice (this is exactly what
 *  happened with USDT TRC20: its minimum turned out to be well above
 *  €1 on this account). Carries the live minimum so callers can report
 *  something concrete rather than a generic failure. */
export class SubscriptionPriceBelowMinimumError extends Error {
  minAmount: number;
  currencyFrom: string;
  currencyTo: string;
  constructor(minAmount: number, currencyFrom: string, currencyTo: string) {
    super(
      `Subscription price (${SUBSCRIPTION_PRICE_AMOUNT} ${currencyFrom}) is below NOWPayments' current minimum of ${minAmount} ${currencyFrom} for ${currencyTo}.`,
    );
    this.name = "SubscriptionPriceBelowMinimumError";
    this.minAmount = minAmount;
    this.currencyFrom = currencyFrom;
    this.currencyTo = currencyTo;
  }
}

function toView(row: PaymentRow): SubscriptionPaymentView {
  return {
    paymentId: row.providerPaymentId,
    status: row.status,
    priceAmount: row.priceAmount,
    priceCurrency: row.priceCurrency,
    payCurrency: row.payCurrency,
    payAmount: row.payAmount,
    paymentUrl: row.paymentUrl,
  };
}

// Dependency-injectable so tests can supply fakes instead of ever
// calling the real NOWPayments API (section 6/10: "do not perform real
// production payments during tests"). Route handlers call
// createSubscriptionPayment with no second argument, which resolves to
// the real client functions.
export interface CheckoutDeps {
  createInvoice: typeof createNowPaymentsInvoice;
  getSupportedCurrencies: typeof getNowPaymentsCurrencies;
  getMinAmount: typeof getNowPaymentsMinAmount;
}

const defaultDeps: CheckoutDeps = {
  createInvoice: createNowPaymentsInvoice,
  getSupportedCurrencies: getNowPaymentsCurrencies,
  getMinAmount: getNowPaymentsMinAmount,
};

/** Creates (or reuses an existing in-flight) 1 USDT (BEP20) subscription
 *  payment for the given user via a hosted NOWPayments invoice.
 *  `userId` must already be the
 *  authenticated caller's id — this function trusts it completely and
 *  has no way to check a session itself; see api/payments/create/
 *  route.ts for that boundary. Price/currency are never parameters
 *  here at all (section 2: "never trust price/currency from the
 *  browser") — there is nothing for a request body to override.
 *
 *  Before ever calling createInvoice, this queries NOWPayments' live
 *  minimum-amount for the fixed price/pay-currency pair and refuses to
 *  create an invoice below it (SubscriptionPriceBelowMinimumError) —
 *  the minimum is NOWPayments' own business/network decision and is
 *  never hardcoded or assumed here, since it can and does change (see
 *  PREFERRED_PAY_CURRENCY's own doc for the incident that made this
 *  necessary). */
export async function createSubscriptionPayment(
  userId: string,
  deps: CheckoutDeps = defaultDeps,
): Promise<SubscriptionPaymentView> {
  // Best-effort duplicate-prevention (section 2): closes the common
  // case (a user double-clicking "subscribe", or a client retry, or
  // navigating back to the subscription page mid-payment) but is not a
  // hard guarantee under true concurrent requests, since the check-
  // then-insert has an await (the NOWPayments call) in between —
  // acceptable for this MVP's scope; see findReusableInFlightPayment's
  // own doc for the reuse window. Also what makes "return to the same
  // pending payment" (Step 3 section 7) work: reusing the row means
  // reusing its already-known paymentUrl.
  const reusable = await findReusableInFlightPayment(userId);
  if (reusable) return toView(reusable);

  // "Prefer USDT BSC if supported" — checked via the existing client,
  // but a failure to confirm support (network hiccup, an incomplete
  // currency list) doesn't block the one currency this product
  // actually offers; it's logged, not fatal.
  try {
    const { currencies } = await deps.getSupportedCurrencies();
    if (!currencies?.includes(PREFERRED_PAY_CURRENCY)) {
      console.warn(
        `[Compass] NOWPayments: ${PREFERRED_PAY_CURRENCY} not found in the reported supported-currencies list; using it anyway.`,
      );
    }
  } catch (err) {
    console.warn(
      "[Compass] NOWPayments: could not verify supported currencies, proceeding with the preferred currency anyway:",
      (err as Error).message,
    );
  }

  // Queried fresh on every call, never cached or hardcoded (section
  // 4: "never hardcode the minimum amount") — NOWPayments' minimum for
  // this currency pair is their own business/network decision and can
  // change without notice. A price below it must never reach
  // createInvoice at all; failing to even reach NOWPayments here (a
  // network hiccup, misconfiguration) also blocks the invoice rather
  // than assuming the price is fine, since there is no safe fallback
  // minimum to compare against.
  const { min_amount: minAmount } = await deps.getMinAmount(SUBSCRIPTION_PRICE_CURRENCY, PREFERRED_PAY_CURRENCY);
  if (SUBSCRIPTION_PRICE_AMOUNT < minAmount) {
    throw new SubscriptionPriceBelowMinimumError(minAmount, SUBSCRIPTION_PRICE_CURRENCY, PREFERRED_PAY_CURRENCY);
  }

  // Generated before calling NOWPayments and reused as both our own
  // payment row's id and their order_id — see createPaymentRecord's
  // doc for why.
  const localId = crypto.randomUUID();
  const ipnCallbackUrl = await absoluteUrl("/api/payments/ipn");
  // Where NOWPayments sends the user back after paying/canceling on
  // their hosted page. Purely a UX convenience — section 4/7 of the
  // spec are explicit that returning here (or any query param on this
  // URL) is NEVER treated as proof of payment; the page always re-
  // queries GET /api/payments/status, which reflects only what the
  // IPN has confirmed.
  const returnUrl = await absoluteUrl("/profile/subscription");

  const response = await deps.createInvoice({
    price_amount: SUBSCRIPTION_PRICE_AMOUNT,
    price_currency: SUBSCRIPTION_PRICE_CURRENCY,
    pay_currency: PREFERRED_PAY_CURRENCY,
    order_id: localId,
    order_description: "Lookwise subscription",
    ipn_callback_url: ipnCallbackUrl,
    success_url: returnUrl,
    cancel_url: returnUrl,
  });

  const row = await createPaymentRecord({
    id: localId,
    userId,
    // No real NOWPayments payment_id exists yet — only once the
    // customer actually starts paying on the hosted invoice page does
    // one get created, and it first becomes known to us via that
    // payment's IPN (see webhook.ts's order_id fallback matching and
    // linkProviderPaymentId). The invoice's own id is unique on
    // NOWPayments' side too, so it's a safe, collision-free
    // placeholder until then — prefixed so it can never be confused
    // with a real (always bare-numeric) payment_id.
    providerPaymentId: `invoice:${response.id}`,
    orderId: localId,
    priceAmount: response.price_amount,
    priceCurrency: response.price_currency,
    payCurrency: response.pay_currency,
    paymentUrl: response.invoice_url,
    status: "waiting",
  });

  return toView(row);
}
