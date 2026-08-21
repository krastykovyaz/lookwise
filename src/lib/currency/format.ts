import { convertCurrency, isSupportedCurrency, type SupportedCurrency } from "./rates";

/** Converts amount from sourceCurrency to targetCurrency and formats
 *  it with Intl.NumberFormat — the one function every price display in
 *  the app should call (section 5: "do NOT merely replace the
 *  currency symbol... conversion must actually happen").
 *
 *  sourceCurrency is whatever the product/look actually carries (eBay
 *  products preserve their real listing currency — see types/product.ts
 *  — never assumed to be EUR). If sourceCurrency isn't one of our
 *  supported currencies, this still formats in the source currency
 *  itself rather than silently mislabeling the amount. */
export function formatPrice(
  amount: number | null | undefined,
  sourceCurrency: string | null | undefined,
  targetCurrency: SupportedCurrency,
  options?: { maximumFractionDigits?: number },
): string | null {
  if (amount == null) return null;
  const source = sourceCurrency ?? targetCurrency;
  const displayAmount = isSupportedCurrency(source) ? convertCurrency(amount, source, targetCurrency) : amount;
  const displayCurrency = isSupportedCurrency(source) ? targetCurrency : source;

  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: displayCurrency,
      maximumFractionDigits: options?.maximumFractionDigits,
    }).format(displayAmount);
  } catch {
    return `${displayAmount.toFixed(2)} ${displayCurrency}`;
  }
}
