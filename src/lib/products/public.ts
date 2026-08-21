import "server-only";
import { getProductById, EbayApiError, EbayAuthError, EbayConfigError } from "@/lib/ebay";
import { getProductByProviderItemId } from "@/lib/db/repositories/product";
import { loadProductsByRowId } from "@/lib/db/repositories/reconstruct";
import { logTechnicalEvent } from "@/lib/maintenance/logger";
import type { Product } from "@/types/product";

/** Used by /item/[itemId] (page + generateMetadata) — unlike
 *  api/buyer/item/[id]'s route, this never throws or returns an error
 *  status: a social crawler or a guest hitting a dead/misconfigured
 *  listing should get a clean "not found" page, not a 500 (section 10:
 *  "do not block Telegram/social crawlers... never return a login
 *  page or an error to crawlers"). Callers treat null as not-found. */
export async function fetchPublicProduct(itemId: string): Promise<Product | null> {
  if (!itemId?.trim()) return null;
  try {
    return await getProductById(itemId);
  } catch (err) {
    if (err instanceof EbayConfigError || err instanceof EbayAuthError || err instanceof EbayApiError) {
      void logTechnicalEvent("ebay_api_error", `getProductById(${itemId}): ${err.message}`);
      return null;
    }
    console.error("[fetchPublicProduct] unexpected error:", err);
    return null;
  }
}

export interface PublicProductResult {
  product: Product;
  /** false when this came from our own cache because the live eBay
   *  fetch failed/returned nothing — the page uses this to show a
   *  "No longer available" state instead of pretending the listing is
   *  still live. */
  isLive: boolean;
}

/** Section 15 of the branding/lifecycle spec: an eBay listing going
 *  away must NOT turn a shared /item/[itemId] link into a 404 — shared
 *  links, Telegram previews, Saved/Favorites, and referral traffic can
 *  all still point at it long after the listing itself is gone. Tries
 *  the live eBay fetch first; if that comes back empty, falls back to
 *  whatever snapshot we already have cached for this item (from any
 *  past view/save/look — see upsertProduct), rendering it with
 *  isLive: false rather than writing anything back to the DB — this
 *  stays a read-only, side-effect-free path so it's exactly as safe
 *  for a crawler to hit as the plain live-only version was. Returns
 *  null only when NEITHER a live fetch NOR a cached snapshot exists —
 *  genuinely nothing to show. */
export async function fetchPublicProductWithFallback(itemId: string): Promise<PublicProductResult | null> {
  const live = await fetchPublicProduct(itemId);
  if (live) return { product: live, isLive: true };

  try {
    const cachedRow = await getProductByProviderItemId("ebay", itemId);
    if (!cachedRow) return null;
    const productsByRowId = await loadProductsByRowId([cachedRow.id]);
    const cachedProduct = productsByRowId.get(cachedRow.id);
    if (!cachedProduct) return null;
    return {
      // The cache row's own availabilityStatus already reflects
      // UNAVAILABLE if a prior check (Overview/Saved — see
      // lib/products/availability.ts) already caught this; if it
      // hasn't yet, this is the first signal we have that it's gone,
      // so show it as unavailable here too without persisting the
      // change (this path never writes).
      product: { ...cachedProduct, availabilityStatus: "UNAVAILABLE" as const },
      isLive: false,
    };
  } catch (err) {
    console.error("[fetchPublicProductWithFallback] cache lookup failed:", err);
    return null;
  }
}
