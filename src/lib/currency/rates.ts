// Static MVP exchange-rate table. Every rate is "1 unit of that
// currency, expressed in USD" — USD is the pivot so adding a new
// currency only ever needs one new entry, not one per existing pair.
// Kept in exactly one place (this file) so nothing else in the app
// hardcodes a conversion factor — replacing this with a real FX API
// later means changing getUsdRate()'s implementation here and
// nowhere else.
//
// Rates are illustrative, not live market data — good enough for an
// MVP display feature, not for anything transactional.

export const SUPPORTED_CURRENCIES = ["EUR", "USD", "GBP"] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export function isSupportedCurrency(value: string | null | undefined): value is SupportedCurrency {
  return !!value && (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}

const USD_RATES: Record<SupportedCurrency, number> = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
};

function getUsdRate(currency: SupportedCurrency): number {
  return USD_RATES[currency];
}

/** Converts an amount from one currency to another via the USD pivot.
 *  Falls back to returning the original amount unchanged if either
 *  currency isn't in the supported table (better than throwing mid-render
 *  for a product in some currency we don't recognize yet). */
export function convertCurrency(
  amount: number,
  from: string,
  to: SupportedCurrency,
): number {
  if (!isSupportedCurrency(from)) return amount;
  if (from === to) return amount;
  const amountInUsd = amount / getUsdRate(from);
  return amountInUsd * getUsdRate(to);
}
