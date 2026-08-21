import "server-only";

/**
 * eBay environment resolution.
 *
 * The Sandbox Browse API is backed by a tiny synthetic catalogue: most
 * real-world queries ("vintage Nike sneakers under $80") legitimately match
 * ZERO sandbox listings, which is exactly what "No results found" means.
 * Browse API search is read-only, so it can be pointed at Production with the
 * same client_credentials app token — set EBAY_ENV=production to get real
 * inventory.
 *
 * EBAY_API_BASE_URL still wins when set (used by the local test stub).
 */
const PRODUCTION_BASE = "https://api.ebay.com";
const SANDBOX_BASE = "https://api.sandbox.ebay.com";

export function isProduction(): boolean {
  return (process.env.EBAY_ENV ?? "sandbox").trim().toLowerCase() === "production";
}

export function ebayBaseUrl(): string {
  const override = process.env.EBAY_API_BASE_URL?.trim();
  if (override) return override;
  return isProduction() ? PRODUCTION_BASE : SANDBOX_BASE;
}

/** Human label used in log lines and error copy. */
export function ebayEnvLabel(): string {
  return isProduction() ? "eBay Production" : "eBay Sandbox";
}

export function marketplaceId(): string {
  return process.env.EBAY_MARKETPLACE_ID?.trim() || "EBAY_US";
}
