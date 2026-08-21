import type { ValidatedEbaySearchCriteria } from "@/lib/schemas";

const DEFAULT_SANDBOX_DELIVERY_COUNTRY = "US";
// This is eBay's own search/filter currency — the currency the
// `price`/`priceCurrency` filter below is expressed in when talking
// to eBay's API. It is INTENTIONALLY independent of the user's
// selected display currency (lib/currency/context.tsx's
// CurrencyProvider) — see that module's README/comment for the full
// rationale. Converting maxPrice/minPrice here to match a display
// preference would silently change what a saved/typed price ceiling
// means server-side; display-currency conversion only ever happens
// at render time (lib/currency/format.ts's formatPrice), never here.
// If a future milestone wants "search in my currency", it should
// convert the criteria into DEFAULT_CURRENCY before it reaches this
// function, not change what this function assumes.
const DEFAULT_CURRENCY = "USD";

/**
 * Very rough condition -> eBay conditionId mapping. eBay's real condition
 * taxonomy is category-specific and much larger than this; Sandbox's test
 * inventory in our manual testing only reliably responded to conditionId
 * 3000 ("Pre-owned - Good") and 1000 (New), so that's what we target here.
 * Revisit with the full taxonomy once this integrates with a real category
 * tree in a later milestone.
 */
export function conditionIdsFor(condition: string[]): string[] | null {
  if (condition.length === 0) return null;
  const text = condition.join(" ").toLowerCase();
  const mentionsNew = /\bnew\b/.test(text);
  const mentionsUsed = /(used|pre-?owned|good|fair|excellent|acceptable)/.test(
    text,
  );
  if (mentionsNew && !mentionsUsed) return ["1000"];
  return ["3000"];
}

/**
 * Builds the eBay `filter` query param value. Pure function — no
 * network — so it can be unit tested against the exact formats we
 * manually verified against Sandbox:
 *   conditionIds:{3000}
 *   deliveryCountry:US
 *   price:[0..20],priceCurrency:USD   (price REQUIRES priceCurrency)
 *
 * minPrice extends the same `price:[min..max]` range syntax with an
 * explicit lower bound (e.g. `price:[700..]` for a 700+ budget band —
 * per eBay's documented compact-range filter syntax, either side of
 * the range may be omitted; only the `[0..max]` / max-only form was
 * hand-verified against Sandbox in earlier milestones).
 */
export function buildFilterString(
  criteria: Pick<
    ValidatedEbaySearchCriteria,
    "condition" | "maxPrice" | "minPrice" | "currency" | "deliveryCountry"
  >,
): string | undefined {
  const parts: string[] = [];

  const conditionIds = conditionIdsFor(criteria.condition ?? []);
  if (conditionIds && conditionIds.length > 0) {
    parts.push(`conditionIds:{${conditionIds.join("|")}}`);
  }

  if (criteria.maxPrice != null || criteria.minPrice != null) {
    const currency = criteria.currency ?? DEFAULT_CURRENCY;
    const min = criteria.minPrice ?? 0;
    const max = criteria.maxPrice != null ? String(criteria.maxPrice) : "";
    parts.push(`price:[${min}..${max}]`);
    parts.push(`priceCurrency:${currency}`);
  }

  const deliveryCountry =
    criteria.deliveryCountry ?? DEFAULT_SANDBOX_DELIVERY_COUNTRY;
  parts.push(`deliveryCountry:${deliveryCountry}`);

  return parts.length > 0 ? parts.join(",") : undefined;
}
