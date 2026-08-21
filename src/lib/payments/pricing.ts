import "server-only";

// Section 2 of the payments spec: "never trust price/currency from the
// browser." Named here once so the create-payment endpoint has no
// numeric literal to accidentally diverge from — a request body can
// never override these because nothing here ever reads from one.
//
// €17: NOWPayments enforces a ~€16.50 account-wide minimum order
// amount across every crypto currency on this merchant account (the
// original €1 price fell below it, causing every checkout attempt to
// be rejected with a 400 on their hosted page) — €17 leaves headroom
// above that floor. This is a temporary test price, not a final one.
export const SUBSCRIPTION_PRICE_AMOUNT = 17;
export const SUBSCRIPTION_PRICE_CURRENCY = "eur";

// NOWPayments' currency code for USDT on the TRON network.
export const PREFERRED_PAY_CURRENCY = "usdttrc20";
