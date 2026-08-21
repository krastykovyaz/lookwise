// Plain price formatting for Open Graph/meta descriptions, generated
// server-side in generateMetadata where there's no CurrencyProvider
// (see lib/currency/format.ts, which is the client-facing equivalent
// used everywhere else in the UI — deliberately not reused here to
// avoid pulling a "use client" dependency chain into a server-only
// metadata function).
export function formatOgPrice(amount: number, currency: string | null | undefined): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency && currency.length === 3 ? currency : "USD",
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${amount.toFixed(0)} ${currency ?? ""}`.trim();
  }
}
