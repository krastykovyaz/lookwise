import "server-only";
import type { Product } from "@/types/product";
import type { RecommendationContext, RecommendationClassification } from "@/types/explore";
import type { BudgetRangeId } from "@/types/style";
import { BUDGET_RANGE_BOUNDS } from "@/types/style";
import { searchProducts } from "@/lib/ebay";
import { TtlCache } from "@/lib/recommendation/cache";
import { weatherKeyword } from "@/lib/recommendation/categorize";

// A single query issued against a provider, tagged with which slice of
// the recommendation mix it's meant to serve. CandidateGenerator uses
// this tag to classify the resulting candidates (section 10).
export interface CandidateQuery {
  text: string;
  classification: RecommendationClassification;
}

// The abstraction that lets Explore add more product providers later
// (own marketplace, Zalando, Nike — section 8) without touching
// ranking/diversification.
export interface CandidateSource {
  fetch(queries: CandidateQuery[], context: RecommendationContext): Promise<RawCandidate[]>;
}

export interface RawCandidate {
  product: Product;
  sourceQuery: string;
  classification: RecommendationClassification;
}

// Short TTL: long enough to dedupe the handful of duplicate queries a
// single feed request or two nearby requests might issue, short enough
// that a refreshed session still feels current.
const searchCache = new TtlCache<Product[]>(60_000);

// Pure and exported so duplicate-prevention (section 7/8) is directly
// testable without a network call — see scripts/verify-recommendation.ts.
export function filterExcluded(products: Product[], excludeIds: string[]): Product[] {
  if (excludeIds.length === 0) return products;
  const excluded = new Set(excludeIds);
  return products.filter((product) => !excluded.has(product.id));
}

// Session-level backstop for "do not show more than 1 item from the
// one seller" — parallel to filterExcluded, keyed on
// product.seller.username instead of product id. A product with no
// seller info at all is never excluded by this (nothing to compare).
export function filterExcludedSellers(products: Product[], excludeSellers: string[]): Product[] {
  if (excludeSellers.length === 0) return products;
  const excluded = new Set(excludeSellers);
  return products.filter((product) => !product.seller?.username || !excluded.has(product.seller.username));
}

// Budget is a hard constraint on familiar and adjacent candidates.
// Exploration gets a deliberately widened version of it (see
// budgetBoundsForClassification below) rather than being unconstrained
// — it may vary style/category/brand, but the price floor it's allowed
// to dip into is still bounded, never arbitrary. "no_preference" and an
// unset budget both resolve to null bounds, i.e. no constraint, which
// is also what naturally produces the "mix price ranges without bias"
// behavior the no-preference case wants: nothing here favors one band
// over another, eBay's own result order for the query is left as-is.
//
// Bounds are half-open [min, max) except the top band (min, no max) —
// matches the exact ranges in the spec: under_100 is price < 100,
// 700_plus is price >= 700, etc.
export function budgetBounds(budgetRange: BudgetRangeId | null): { min: number; max: number | null } | null {
  if (!budgetRange || budgetRange === "no_preference") return null;
  return BUDGET_RANGE_BOUNDS[budgetRange];
}

// The band immediately below each budget band, in ascending price
// order (BUDGET_RANGES) — used only to widen the exploration slice
// (see budgetBoundsForClassification below). under_100 and
// no_preference have nothing lower, so they map to null.
const PREVIOUS_BUDGET_RANGE: Record<BudgetRangeId, BudgetRangeId | null> = {
  under_100: null,
  "100_200": "under_100",
  "200_400": "100_200",
  "400_700": "200_400",
  "700_plus": "400_700",
  no_preference: null,
};

// Familiar and adjacent candidates stay strictly inside the user's
// exact selected budget band. Exploration is allowed to also reach one
// band down (the "previous", cheaper segment) — it may vary
// style/category/brand AND now also dip slightly below the user's
// price floor, but it still never goes above the user's own band's
// ceiling, and familiar/adjacent are completely unaffected. Returns
// the same value as budgetBounds() for any non-exploration
// classification, or for exploration when there's no lower band to
// include (already at under_100, or budget is unconstrained).
export function budgetBoundsForClassification(
  budgetRange: BudgetRangeId | null,
  classification: RecommendationClassification,
): { min: number; max: number | null } | null {
  const ownBounds = budgetBounds(budgetRange);
  if (classification !== "exploration" || !budgetRange) return ownBounds;
  const previous = PREVIOUS_BUDGET_RANGE[budgetRange];
  if (!previous) return ownBounds;
  return { min: BUDGET_RANGE_BOUNDS[previous].min, max: ownBounds ? ownBounds.max : null };
}

export function isWithinBudget(price: number, budgetRange: BudgetRangeId | null): boolean {
  const bounds = budgetBounds(budgetRange);
  if (!bounds) return true;
  if (price < bounds.min) return false;
  if (bounds.max != null && price >= bounds.max) return false;
  return true;
}

export function isWithinBudgetForClassification(
  price: number,
  budgetRange: BudgetRangeId | null,
  classification: RecommendationClassification,
): boolean {
  const bounds = budgetBoundsForClassification(budgetRange, classification);
  if (!bounds) return true;
  if (price < bounds.min) return false;
  if (bounds.max != null && price >= bounds.max) return false;
  return true;
}

// Pure and exported so the hard budget constraint (not just the
// scoring-layer budgetMatch signal) is directly unit-testable — see
// scripts/verify-explore-pagination.ts. Applied to every candidate
// source's raw results, independent of eBay's own price filter, since
// EbayCandidateSource's shared search pipeline (buildSearchAttempts)
// can relax/drop the price filter to avoid an empty result set — this
// is the backstop that guarantees an out-of-budget item never reaches
// the feed regardless of what eBay actually returned.
export function filterByBudget(products: Product[], budgetRange: BudgetRangeId | null): Product[] {
  return products.filter((product) => isWithinBudget(product.price, budgetRange));
}

// Same as filterByBudget, but widens the range for exploration-tagged
// candidates to also include the previous (cheaper) band — see
// budgetBoundsForClassification.
export function filterByBudgetForClassification(
  products: Product[],
  budgetRange: BudgetRangeId | null,
  classification: RecommendationClassification,
): Product[] {
  return products.filter((product) => isWithinBudgetForClassification(product.price, budgetRange, classification));
}

const EBAY_PAGE_SIZE = 20;
// How many generations deep we're willing to page into eBay's result
// set for a single session before flattening back to the last page
// rather than growing the offset forever. Pure and exported so it's
// directly unit-testable — see scripts/verify-explore-pagination.ts.
export function computeEbayOffset(poolGeneration: number): number {
  return Math.max(0, Math.min(poolGeneration, 20)) * EBAY_PAGE_SIZE;
}

class EbayCandidateSource implements CandidateSource {
  async fetch(queries: CandidateQuery[], context: RecommendationContext): Promise<RawCandidate[]> {
    // Coordinates alone don't reliably give a delivery country, and the
    // existing eBay integration targets EBAY_US regardless — see lib/look,
    // which makes the same choice for the AI look generator.
    const deliveryCountry = null;
    // Page deeper into eBay's result set on each pool regeneration
    // (generation 0 = offset 0, generation 1 = offset 20, ...) instead
    // of re-requesting the same top page every time — that repeated
    // top page is what was getting filtered out as already-shown and
    // starving the feed.
    const offset = computeEbayOffset(context.poolGeneration);
    // Best-effort price constraint passed to eBay itself, computed per
    // query (not once for the whole batch) since exploration queries
    // get a widened range — see budgetBoundsForClassification. This
    // alone isn't sufficient (buildSearchAttempts may relax/drop it to
    // avoid a 0-result response), so the local filter below is the
    // authority.
    // Candidate generation can contain the same query/classification more than
    // once. Deduplicate before Promise.all so identical eBay searches do not
    // race each other and multiply latency (the TTL cache cannot prevent
    // concurrent misses). This is especially important for Explore because
    // each miss may walk the eBay fallback-attempt ladder.
    const uniqueQueries = Array.from(
      new Map(
        queries.map((q) => [
          `${q.text.trim().toLowerCase()}::${q.classification}`,
          q,
        ]),
      ).values(),
    );

    const results = await Promise.all(
      uniqueQueries.map(async (q) => {
        const bounds = budgetBoundsForClassification(context.budgetRange, q.classification);
        const cacheKey = `${q.text}::${context.budgetRange ?? "any"}::${q.classification}::${offset}`;
        let items = searchCache.get(cacheKey);
        if (!items) {
          try {
            const result = await searchProducts(
              {
                query: q.text,
                category: null,
                brand: null,
                condition: [],
                color: null,
                minPrice: bounds?.min ?? null,
                maxPrice: bounds?.max ?? null,
                currency: null,
                deliveryCountry,
                size: null,
                keywords: [],
              },
              { offset, pageSize: EBAY_PAGE_SIZE },
            );
            items = result.items;
            searchCache.set(cacheKey, items);
          } catch (err) {
            // A single failed query source should not take down the whole
            // feed (section 22: "If eBay is temporarily unavailable, do
            // not crash Explore").
            console.error(`[Compass] Explore candidate query failed: "${q.text}"`, err);
            items = [];
          }
        }
        // Budget is enforced locally (not just via eBay's own price
        // filter above) so a relaxed/fallback eBay attempt — or a
        // cached response from before the filter existed — can never
        // let an out-of-budget item through. Classification-aware so
        // exploration's widened (previous-band-inclusive) range is
        // actually honored here too, not just at the eBay query level.
        // filterExcludedSellers is the session-level backstop for "at
        // most 1 item per seller" — catching sellers already shown in
        // an earlier request. It can't catch two DIFFERENT queries in
        // this same batch surfacing the same not-yet-excluded seller;
        // that cross-query case is handled by dedupeFeedItems in
        // engine.ts, which sees the whole page at once.
        return filterExcludedSellers(
          filterExcluded(filterByBudgetForClassification(items, context.budgetRange, q.classification), context.excludeIds),
          context.excludeSellers,
        ).map((product): RawCandidate => ({ product, sourceQuery: q.text, classification: q.classification }));
      }),
    );
    return results.flat();
  }
}

export const ebayCandidateSource: CandidateSource = new EbayCandidateSource();

// Style archetype -> a couple of concrete marketplace search terms.
// Deliberately simple keyword mapping, not a taxonomy (section 24: do
// not overbuild).
const STYLE_QUERY_TERMS: Record<string, string[]> = {
  minimalist: ["minimalist", "plain"],
  street: ["streetwear", "oversized"],
  smart_casual: ["smart casual", "chinos"],
  classic: ["classic", "tailored"],
  vintage: ["vintage", "retro"],
  functional: ["technical", "utility"],
  sporty: ["athletic", "sneakers"],
  experimental: ["avant garde", "statement"],
};

const CATEGORY_ANCHORS = ["sneakers", "jacket", "t-shirt", "jeans"];

// Cyclically shifts an array by `by` positions. Pure and exported so
// it's directly unit-testable — see scripts/verify-explore-pagination.ts.
// Used to rotate which search terms buildCandidateQueries picks as the
// pool generation advances, so a regenerated pool taps genuinely
// different terms — not just a deeper eBay offset into the *same*
// terms — reducing how often two regenerations end up finding mostly
// the same items (and, eventually, how often the recycle-when-
// exhausted fallback in engine.ts has to engage at all).
export function rotate<T>(items: T[], by: number): T[] {
  if (items.length === 0) return items;
  const n = ((by % items.length) + items.length) % items.length;
  return [...items.slice(n), ...items.slice(0, n)];
}

// Builds the CandidateGenerator's query plan from context: familiar
// queries from the explicit profile + top behavioral brands/categories,
// adjacent queries loosen those slightly, exploration queries pick
// something outside the user's usual pattern. This is the only place
// RecommendationMix (section 10) actually influences *what's fetched*;
// the ranker/diversifier work with what comes back.
export function buildCandidateQueries(context: RecommendationContext): CandidateQuery[] {
  const queries: CandidateQuery[] = [];
  const generation = context.poolGeneration;
  const styles = context.profile?.styleArchetypes ?? [];
  // Rotates which of a style's 2 terms is "primary" as generation
  // advances, instead of always favoring index 0.
  const styleTerms = styles.flatMap((id) => rotate(STYLE_QUERY_TERMS[id] ?? [], generation));

  // Familiar: explicit style + liked brands/categories from behavior.
  const topBrands = Object.entries(context.behavioral.brands)
    .filter(([, v]) => v > 0.6)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([k]) => k);
  const topCategories = Object.entries(context.behavioral.categories)
    .filter(([, v]) => v > 0.6)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([k]) => k);

  // Rotated by generation so a regenerated pool's familiar/adjacent
  // split cycles through all of CATEGORY_ANCHORS over time rather than
  // familiar always getting the same first 2 and adjacent the same
  // last 2.
  const rotatedAnchors = rotate(CATEGORY_ANCHORS, generation);
  for (const anchor of rotatedAnchors.slice(0, 2)) {
    const term = styleTerms[0] ? `${styleTerms[0]} ${anchor}` : anchor;
    queries.push({ text: term, classification: "familiar" });
  }
  for (const brand of topBrands) queries.push({ text: brand, classification: "familiar" });
  for (const category of topCategories) queries.push({ text: category, classification: "familiar" });

  const wx = weatherKeyword(
    context.weather?.temperature ?? null,
    context.weather?.condition === "rain" || context.weather?.condition === "storm",
  );
  if (wx) queries.push({ text: wx, classification: "familiar" });

  // Adjacent: a second style term or a nearby category anchor not
  // already covered.
  if (styleTerms[1]) queries.push({ text: styleTerms[1], classification: "adjacent" });
  for (const anchor of rotatedAnchors.slice(2)) {
    queries.push({ text: anchor, classification: "adjacent" });
  }

  // Exploration: an archetype outside the user's stated ones, so the
  // feed occasionally surfaces something unexpected (section 10).
  // Rotated by generation across ALL unexplored styles (and both of
  // that style's terms), not just always the first one — this is the
  // single biggest lever for genuine novelty across regenerations,
  // since exploration is specifically meant to range outside the
  // user's usual pattern.
  const unexploredStyles = Object.keys(STYLE_QUERY_TERMS).filter((id) => !(styles as string[]).includes(id));
  if (unexploredStyles.length > 0) {
    const rotatedUnexplored = rotate(unexploredStyles, generation);
    const pick = rotatedUnexplored[0];
    const pickTerms = rotate(STYLE_QUERY_TERMS[pick], generation);
    queries.push({ text: pickTerms[0], classification: "exploration" });
  }

  // A safety-net generic query so a brand-new user with no profile and
  // no history still gets a usable feed (section 26, TEST 1).
  if (queries.length === 0) {
    queries.push({ text: "sneakers", classification: "familiar" }, { text: "jacket", classification: "adjacent" });
  }

  // Bounded: this is a batch (section 8), not a bulk fetch.
  return queries.slice(0, 8);
}
