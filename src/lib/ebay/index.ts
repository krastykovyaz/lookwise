// eBay Browse API boundary — public surface for the rest of the app.
//
// Server-only (imports "server-only" transitively via browse.ts).
// Never call these from a client component; they must be reached
// through a route handler (see src/app/api/buyer).

import "server-only";
import { searchItems, getItemById, EbayApiError } from "@/lib/ebay/browse";
import { EbayAuthError, EbayConfigError } from "@/lib/ebay/client";
import { isProduction } from "@/lib/ebay/env";
import { normalizeSearchResults, normalizeItem } from "@/lib/ebay/normalize";
import type { Product } from "@/types/product";
import type { ValidatedEbaySearchCriteria } from "@/lib/schemas";

export { EbayApiError, EbayAuthError, EbayConfigError };

export interface EbaySearchResult {
  items: Product[];
  total: number;
  /** True when constraints had to be loosened to find anything. */
  relaxed: boolean;
  environment: "sandbox" | "production";
}

const SEARCH_PAGE_SIZE = 200;

// Fetches exactly one page (one eBay call). The buyer Search route pages
// through results 200 at a time as the client asks for more (see
// POST /api/buyer/search's `offset`) instead of eagerly aggregating every
// page up front — with results that can run into the thousands, blocking
// the response on every page meant the first paint could take tens of
// seconds. Explore explicitly requests 20-item pages because its offset
// advances by 20 and eBay requires offset to be zero or a multiple of the
// request limit.
export async function searchProducts(
  criteria: ValidatedEbaySearchCriteria,
  { offset = 0, pageSize = SEARCH_PAGE_SIZE }: { offset?: number; pageSize?: number } = {},
): Promise<EbaySearchResult> {
  const page = await searchItems(criteria, { limit: pageSize, offset });
  const items = normalizeSearchResults(page.response.itemSummaries ?? []);

  return {
    items,
    total: page.response.total ?? items.length,
    relaxed: page.relaxed && items.length > 0,
    environment: isProduction() ? "production" : "sandbox",
  };
}

export async function getProductById(itemId: string): Promise<Product> {
  const item = await getItemById(itemId);
  return normalizeItem(item);
}
