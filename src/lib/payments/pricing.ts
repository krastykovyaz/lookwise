import "server-only";

// Section 2 of the payments spec: "never trust price/currency from the
// browser." Named here once so the create-payment endpoint has no
// numeric literal to accidentally diverge from — a request body can
// never override these because nothing here ever reads from one.
//
// Priced directly in USDT, not EUR — confirmed with NOWPayments
// support (see this project's history) that GET /v1/min-amount and
// invoice creation apply a much higher "fiat on-ramp" minimum
// (~€16.50) to ANY invoice whose price_currency is a fiat currency,
// even when the customer actually pays in crypto. The exact same
// invoice priced directly in a crypto currency instead routes through
// the crypto-to-crypto flow, whose minimum is a small fraction of a
// dollar — verified end-to-end against the real hosted-checkout
// confirmation step down to 0.1 USDT. price_currency and
// pay_currency are the same currency here for exactly that reason.
export const SUBSCRIPTION_PRICE_AMOUNT = 1;
export const SUBSCRIPTION_PRICE_CURRENCY = "usdtbsc";

// NOWPayments' currency code for USDT on BNB Smart Chain (BEP20).
export const PREFERRED_PAY_CURRENCY = "usdtbsc";
