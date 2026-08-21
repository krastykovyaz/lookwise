import "server-only";
import { getEbayAccessToken } from "@/lib/ebay/client";
import { buildFilterString } from "@/lib/ebay/filters";
import { ebayBaseUrl, ebayEnvLabel, marketplaceId } from "@/lib/ebay/env";
import type {
  EbayApiErrorBody,
  EbayItem,
  EbaySearchResponse,
} from "@/lib/ebay/types";
import type { ValidatedEbaySearchCriteria } from "@/lib/schemas";

export { buildFilterString };

export class EbayApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "EbayApiError";
    this.status = status;
  }
}

export function buildSearchQuery(criteria: ValidatedEbaySearchCriteria): string {
  // Dedupe case-insensitively: the AI often repeats the brand inside `query`
  // and again in `brand`/`keywords`, and eBay treats duplicated tokens as
  // extra required terms, which needlessly shrinks the result set.
  const seen = new Set<string>();
  const words: string[] = [];
  for (const value of [criteria.query, criteria.brand, ...(criteria.keywords ?? [])]) {
    if (!value || !value.trim()) continue;
    for (const word of value.trim().split(/\s+/)) {
      const key = word.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      words.push(word);
    }
  }
  return words.join(" ") || criteria.query;
}

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "X-EBAY-C-MARKETPLACE-ID": marketplaceId(),
    "Content-Type": "application/json",
  };
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as EbayApiErrorBody;
    return (
      body.errors?.[0]?.longMessage ??
      body.errors?.[0]?.message ??
      response.statusText
    );
  } catch {
    return response.statusText;
  }
}

async function ebayFetch<T>(path: string, params: URLSearchParams): Promise<T> {
  const token = await getEbayAccessToken();
  const url = `${ebayBaseUrl()}${path}?${params.toString()}`;

  let response: Response;
  try {
    response = await fetch(url, { headers: headers(token) });
  } catch (err) {
    throw new EbayApiError(
      `Could not reach ${ebayEnvLabel()}: ${(err as Error).message}`,
      0,
    );
  }

  if (!response.ok) {
    const message = await readErrorMessage(response);
    // Path + params only: the Authorization header is never logged.
    console.error(
      `[Compass] eBay search error: HTTP ${response.status} ${message} (${path}?${params.toString()})`,
    );
    throw new EbayApiError(message, response.status);
  }

  return (await response.json()) as T;
}

export interface SearchAttempt {
  q: string;
  filter?: string | undefined;
  label: string;
}

/**
 * Progressively looser attempts, most specific first.
 *
 * Why: a single strict query returns 0 items far too easily — the AI-derived
 * condition filter, the price ceiling and the extra brand/keyword terms each
 * remove listings, and in Sandbox they usually remove all of them. We keep the
 * first attempt exact and then peel constraints off one at a time so a user
 * always sees the closest available inventory instead of an empty state.
 */
export function buildSearchAttempts(
  criteria: ValidatedEbaySearchCriteria,
): SearchAttempt[] {
  const fullQuery = buildSearchQuery(criteria);
  const baseQuery = criteria.query?.trim() || fullQuery;
  const firstTerm = baseQuery.split(/\s+/).slice(0, 2).join(" ") || baseQuery;

  const withAll = buildFilterString(criteria);
  const withoutCondition = buildFilterString({ ...criteria, condition: [] });
  const withoutPrice = buildFilterString({
    ...criteria,
    condition: [],
    maxPrice: null,
    minPrice: null,
  });

  const attempts: SearchAttempt[] = [
    { q: fullQuery, filter: withAll, label: "exact" },
    { q: fullQuery, filter: withoutCondition, label: "no-condition" },
    { q: baseQuery, filter: withoutCondition, label: "base-query" },
    { q: baseQuery, filter: withoutPrice, label: "no-price" },
    { q: firstTerm, filter: undefined, label: "broad" },
  ];

  // Drop consecutive duplicates (common when the AI returned no condition or
  // no price, so several attempts collapse to the same request).
  const seen = new Set<string>();
  return attempts.filter((a) => {
    const key = `${a.q}||${a.filter ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function searchItemsOnce(
  attempt: SearchAttempt,
  { limit = 20, offset = 0 }: { limit?: number; offset?: number } = {},
): Promise<EbaySearchResponse> {
  const params = new URLSearchParams({
    q: attempt.q,
    limit: String(limit),
    offset: String(offset),
  });
  if (attempt.filter) params.set("filter", attempt.filter);

  console.log(
    `[Compass] eBay search attempt (${attempt.label}) on ${ebayEnvLabel()}: q="${attempt.q}" filter="${attempt.filter ?? ""}" limit=${limit}`,
  );

  return ebayFetch<EbaySearchResponse>(
    "/buy/browse/v1/item_summary/search",
    params,
  );
}

export interface SearchItemsOutcome {
  response: EbaySearchResponse;
  attempt: SearchAttempt;
  relaxed: boolean;
}

/**
 * Runs the attempt ladder and returns the first non-empty result set.
 * Falls back to the last response (empty) when nothing matched anywhere.
 */
export async function searchItems(
  criteria: ValidatedEbaySearchCriteria,
  { limit = 20, offset = 0 }: { limit?: number; offset?: number } = {},
): Promise<SearchItemsOutcome> {
  const attempts = buildSearchAttempts(criteria);
  let last: EbaySearchResponse = { itemSummaries: [], total: 0 };

  for (const [index, attempt] of attempts.entries()) {
    const response = await searchItemsOnce(attempt, { limit, offset });
    last = response;
    const count = response.itemSummaries?.length ?? 0;
    if (count > 0) {
      console.log(
        `[Compass] eBay search matched ${count} items on attempt "${attempt.label}"`,
      );
      return { response, attempt, relaxed: index > 0 };
    }
    console.log(`[Compass] eBay search attempt "${attempt.label}" returned 0 items`);
  }

  return {
    response: last,
    attempt: attempts[attempts.length - 1]!,
    relaxed: attempts.length > 1,
  };
}

/**
 * Builds the eBay item URL. Pure + exported so the encoding is regression
 * tested (see scripts/verify-product-id.ts): the id contains pipes
 * (v1|110589983217|0) and must be percent-encoded exactly once, as a
 * single path segment — never left raw and never double-encoded.
 */
export function buildItemUrl(itemId: string): string {
  return `${ebayBaseUrl()}/buy/browse/v1/item/${encodeURIComponent(itemId)}`;
}

/** Legacy (numeric) ids need a different endpoint than RESTful `v1|...|0` ids. */
export function buildLegacyItemUrl(legacyId: string): string {
  const params = new URLSearchParams({ legacy_item_id: legacyId });
  return `${ebayBaseUrl()}/buy/browse/v1/item/get_item_by_legacy_id?${params.toString()}`;
}

/** `v1|110589983217|0` -> `110589983217`; plain numeric ids pass through. */
export function legacyIdFrom(itemId: string): string | null {
  if (/^\d{6,}$/.test(itemId)) return itemId;
  const match = /^v1\|(\d+)\|\d*$/.exec(itemId);
  return match?.[1] ?? null;
}

async function fetchItem(url: string, itemId: string): Promise<EbayItem> {
  const token = await getEbayAccessToken();

  let response: Response;
  try {
    response = await fetch(url, { headers: headers(token) });
  } catch (err) {
    throw new EbayApiError(
      `Could not reach ${ebayEnvLabel()}: ${(err as Error).message}`,
      0,
    );
  }

  if (!response.ok) {
    const message = await readErrorMessage(response);
    console.error(
      `[Compass] eBay item lookup error: HTTP ${response.status} ${message} (id="${itemId}")`,
    );
    throw new EbayApiError(message, response.status);
  }

  return (await response.json()) as EbayItem;
}

export async function getItemById(itemId: string): Promise<EbayItem> {
  console.log(`[Compass] eBay item lookup started on ${ebayEnvLabel()}: id="${itemId}"`);
  const legacyId = legacyIdFrom(itemId);

  // A plain numeric id is never valid for /item/{item_id}; go straight to the
  // legacy endpoint so those links stop 404-ing.
  if (legacyId && legacyId === itemId) {
    return fetchItem(buildLegacyItemUrl(legacyId), itemId);
  }

  try {
    return await fetchItem(buildItemUrl(itemId), itemId);
  } catch (err) {
    const notFound = err instanceof EbayApiError && (err.status === 404 || err.status === 400);
    if (notFound && legacyId) {
      console.log(`[Compass] retrying item lookup via legacy id ${legacyId}`);
      return fetchItem(buildLegacyItemUrl(legacyId), itemId);
    }
    throw err;
  }
}
