import "server-only";

// Section 2 of the payments spec: "fixed price = €1.00... never trust
// price/currency from the browser." Named here once so the create-
// payment endpoint has no numeric literal to accidentally diverge from
// — a request body can never override these because nothing here ever
// reads from one.
export const SUBSCRIPTION_PRICE_AMOUNT = 1;
export const SUBSCRIPTION_PRICE_CURRENCY = "eur";

// NOWPayments' currency code for USDT on the TRON network.
export const PREFERRED_PAY_CURRENCY = "usdttrc20";
