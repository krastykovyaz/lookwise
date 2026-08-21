/**
 * Regression tests for the Explore pagination/dedup fix.
 * Run: npm run verify:explore (bundled into `npm run verify`)
 *
 * Bug being guarded against: the cursor used to carry the session's
 * entire shown-id history (`excludeIds`), which grew without bound as
 * a user scrolled and eventually pushed the base64-encoded cursor past
 * ExploreQuerySchema's cursor length cap — a 400 invalid_request after
 * enough pages. The fix makes sessionId + server-side getShownIds() the
 * single source of truth for shown ids, so the cursor only ever carries
 * { poolId, offsets }.
 *
 * Like verify-recommendation.ts's test G, this exercises the real
 * pool/cursor/mixSelector/dedup logic against a large synthetic pool
 * rather than a live eBay call (this sandbox's network egress can't
 * reach api.sandbox.ebay.com — see project notes).
 */
import "server-only";
import { readFileSync, readdirSync } from "fs";
import path from "path";
import type { BucketedPool, ExploreFeedItem, RecommendationClassification } from "../src/types/explore";
import { DEFAULT_RECOMMENDATION_MIX } from "../src/types/explore";
import type { Product } from "../src/types/product";
import {
  addShownIds,
  createPoolId,
  decodeCursor,
  encodeCursor,
  getPool,
  getShownIds,
  nextPoolGeneration,
  resetPoolGeneration,
  resetShownIds,
  storePool,
  type ExploreCursor,
} from "../src/lib/recommendation/pool";
import { emptyOffsets, isPoolExhausted, partitionByClassification, selectMixedPage } from "../src/lib/recommendation/mixSelector";
import { dedupeFeedItems, shuffle } from "../src/lib/recommendation/engine";
import {
  computeEbayOffset,
  filterByBudget,
  filterByBudgetForClassification,
  isWithinBudget,
  isWithinBudgetForClassification,
  budgetBounds,
  budgetBoundsForClassification,
  rotate,
  buildCandidateQueries,
  filterExcludedSellers,
} from "../src/lib/recommendation/candidateSource";
import { ExploreQuerySchema } from "../src/lib/schemas";
import type { BudgetRangeId, StyleArchetypeId } from "../src/types/style";
import { createEmptyBehavioralPreferences } from "../src/types/events";
import { BUDGET_RANGES } from "../src/types/style";
import { feedProfileSignature, isFeedInvalidatingChange, shouldPrefetch, SingleFlightGuard } from "../src/lib/explore/prefetch";

let failures = 0;

function check(name: string, ok: boolean, detail: string) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} — ${name}`);
  console.log(`  ${detail}`);
}

// ---------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------

function fakeProduct(id: string, price = 50): Product {
  return {
    id,
    title: `Item ${id}`,
    price,
    currency: "USD",
    image: "https://i.ebayimg.com/x.jpg",
    condition: "New",
    conditionId: "1000",
    brand: null,
    color: null,
    category: null,
    seller: null,
    location: null,
    shipping: null,
    returnPolicy: null,
    availability: null,
    buyingOptions: ["FIXED_PRICE"],
    itemWebUrl: null,
    dealScore: null,
  };
}

// Supports multi-product looks (2+ components) so dedup is exercised
// against assembled outfits, not just single-item spotlight cards.
function fakeFeedItem(
  lookId: string,
  classification: RecommendationClassification,
  productIds: string[],
): ExploreFeedItem {
  return {
    look: {
      id: lookId,
      title: lookId,
      components: productIds.map((pid, i) => ({
        role: i === 0 ? "top" : "bottom",
        searchQuery: "test",
        productId: pid,
        product: fakeProduct(pid),
        alternatives: [],
      })),
      totalPrice: 50 * productIds.length,
      currency: "USD",
      styleNotes: [],
    },
    classification,
  };
}

// Like fakeFeedItem, but lets each component specify a seller — used
// for the seller-uniqueness tests below.
function fakeFeedItemWithSellers(
  lookId: string,
  classification: RecommendationClassification,
  components: Array<{ productId: string; seller: string | null }>,
): ExploreFeedItem {
  return {
    look: {
      id: lookId,
      title: lookId,
      components: components.map((c, i) => ({
        role: i === 0 ? "top" : "bottom",
        searchQuery: "test",
        productId: c.productId,
        product: {
          ...fakeProduct(c.productId),
          seller: c.seller ? { username: c.seller, feedbackScore: 100, feedbackPercentage: 100 } : null,
        },
        alternatives: [],
      })),
      totalPrice: 50 * components.length,
      currency: "USD",
      styleNotes: [],
    },
    classification,
  };
}

// Simulates one full /api/explore GET, using the real pool/cursor/
// mixSelector/dedup pieces, against a shared in-memory session store —
// exactly what route.ts + engine.ts do, minus the network-bound
// candidate generation on pool regeneration (stubbed via
// regeneratePool below).
function simulateRequest(
  sessionId: string,
  cursorStr: string | null,
  regeneratePool: () => BucketedPool,
) {
  const cursor = decodeCursor(cursorStr);
  let pool = cursor ? getPool(cursor.poolId) : undefined;
  let poolId = cursor?.poolId ?? null;
  let offsets = cursor?.offsets ?? emptyOffsets();

  if (!pool) {
    pool = regeneratePool();
    poolId = createPoolId();
    storePool(poolId, pool);
    offsets = emptyOffsets();
  }

  const shownSoFar = getShownIds(sessionId);
  const { page: selectedPage, offsets: nextOffsets } = selectMixedPage(pool, offsets, DEFAULT_RECOMMENDATION_MIX, 10);
  let page = dedupeFeedItems(selectedPage, shownSoFar);
  let recycled = false;

  // Mirrors engine.ts: before recycling, scan the whole pool (not just
  // this offset-window slice) for anything not yet shown — the slice
  // alone can come back entirely already-shown while the rest of the
  // pool still has fresh candidates further in.
  if (page.length === 0 && selectedPage.length > 0) {
    const wholePool = [...pool.familiar, ...pool.adjacent, ...pool.exploration];
    const freshFromWholePool = dedupeFeedItems(wholePool, shownSoFar).slice(0, 10);
    if (freshFromWholePool.length > 0) page = freshFromWholePool;
  }
  if (page.length === 0 && selectedPage.length > 0) {
    // Mirrors engine.ts's recycle-when-exhausted fallback: never
    // dead-end the feed just because a finite pool has been fully seen.
    page = shuffle(selectedPage);
    recycled = true;
  }
  const poolExhausted = isPoolExhausted(pool, nextOffsets);

  const nextCursorObj: ExploreCursor = {
    poolId: poolExhausted ? createPoolId() : (poolId as string),
    offsets: poolExhausted ? emptyOffsets() : nextOffsets,
  };
  const nextCursor = encodeCursor(nextCursorObj);

  const shownNow = page.flatMap((item) => item.look.components.map((c) => c.productId).filter((id): id is string => Boolean(id)));
  addShownIds(sessionId, shownNow);

  return { page, nextCursor, hasMore: page.length > 0, poolExhausted, recycled };
}

function buildPool(prefix: string, sizePerBucket: number): BucketedPool {
  const items: ExploreFeedItem[] = [];
  for (let i = 0; i < sizePerBucket; i++) items.push(fakeFeedItem(`${prefix}-f${i}`, "familiar", [`${prefix}-f${i}-top`, `${prefix}-f${i}-bottom`]));
  for (let i = 0; i < Math.round(sizePerBucket * 0.3); i++) items.push(fakeFeedItem(`${prefix}-a${i}`, "adjacent", [`${prefix}-a${i}`]));
  for (let i = 0; i < Math.round(sizePerBucket * 0.15); i++) items.push(fakeFeedItem(`${prefix}-e${i}`, "exploration", [`${prefix}-e${i}`]));
  return partitionByClassification(items);
}

// Like buildPool, but merges in a second, always-identical "overlap"
// prefix alongside a fresh-each-call prefix — used to prove session
// exclusion (not the pool's own internal dedup) is what filters out
// the overlapping portion, while the fresh portion keeps real supply
// available so the test doesn't spuriously fall into the
// recycle-when-exhausted path (that's test M's job to cover).
function buildOverlappingAndFreshPool(overlapPrefix: string, freshPrefix: string, sizePerBucket: number): BucketedPool {
  const overlap = buildPool(overlapPrefix, sizePerBucket);
  const fresh = buildPool(freshPrefix, sizePerBucket);
  return partitionByClassification([...overlap.familiar, ...overlap.adjacent, ...overlap.exploration, ...fresh.familiar, ...fresh.adjacent, ...fresh.exploration]);
}

// ---------------------------------------------------------------------
// A. Cursor shape — only poolId + offsets, decodeCursor rejects/strips
//    a legacy cursor that still carries excludeIds.
// ---------------------------------------------------------------------
{
  const cursor: ExploreCursor = { poolId: "abc-123", offsets: { familiar: 7, adjacent: 2, exploration: 1 } };
  const encoded = encodeCursor(cursor);
  const decoded = decodeCursor(encoded);
  check(
    "cursor round-trips with only poolId + offsets",
    JSON.stringify(decoded) === JSON.stringify(cursor),
    `decoded: ${JSON.stringify(decoded)}`,
  );
  check(
    "encoded cursor has no 'excludeIds' key",
    !JSON.parse(Buffer.from(encoded, "base64url").toString("utf-8")).excludeIds,
    `raw: ${Buffer.from(encoded, "base64url").toString("utf-8")}`,
  );

  // A pre-fix cursor carrying a large excludeIds array should still
  // decode fine — poolId/offsets are trusted, excludeIds is ignored.
  const legacyRaw = Buffer.from(
    JSON.stringify({ poolId: "legacy-pool", offsets: { familiar: 3, adjacent: 1, exploration: 0 }, excludeIds: Array.from({ length: 500 }, (_, i) => `id-${i}`) }),
    "utf-8",
  ).toString("base64url");
  const legacyDecoded = decodeCursor(legacyRaw);
  check(
    "legacy cursor with excludeIds decodes and drops the field",
    legacyDecoded !== null && legacyDecoded.poolId === "legacy-pool" && !("excludeIds" in legacyDecoded),
    `decoded: ${JSON.stringify(legacyDecoded)}`,
  );
}

// ---------------------------------------------------------------------
// B. Cursor stays small across 10+ pages / 100+ unique products, and
//    always validates against ExploreQuerySchema's cursor length cap.
// ---------------------------------------------------------------------
{
  resetShownIds("session-long");
  const pool = buildPool("longfeed", 80); // 80 familiar (160 products) + 24 adjacent + 12 exploration = ~196 items
  const poolId = createPoolId();
  storePool(poolId, pool);

  let cursorStr: string | null = null;
  const allShown = new Set<string>();
  let duplicateAcrossPages = false;
  let pages = 0;
  let maxCursorLen = 0;
  let anyCursorTooLong = false;
  // Each regeneration produces genuinely fresh ids (like the real
  // engine's offset-paged eBay refetch would), not an identical repeat
  // — this test is about steady-state pagination with ample supply, not
  // the exhaustion/recycle path (that's test M below).
  let regenCount = 0;

  while (pages < 15) {
    const result = simulateRequest("session-long", cursorStr, () => buildPool(`longfeed-regen-${regenCount++}`, 80));
    if (!result.hasMore && pages > 0) break;
    for (const item of result.page) {
      for (const c of item.look.components) {
        if (!c.productId) continue;
        if (allShown.has(c.productId)) duplicateAcrossPages = true;
        allShown.add(c.productId);
      }
    }
    maxCursorLen = Math.max(maxCursorLen, result.nextCursor.length);
    if (!ExploreQuerySchema.shape.cursor.safeParse(result.nextCursor).success) anyCursorTooLong = true;
    cursorStr = result.nextCursor;
    pages++;
  }

  check(
    "10+ pages served with no duplicate product ids across the session",
    pages >= 10 && !duplicateAcrossPages && allShown.size >= 100,
    `pages: ${pages}, unique products shown: ${allShown.size}, duplicate found: ${duplicateAcrossPages}`,
  );
  check(
    "cursor stays well under the 4000-char schema limit across all pages",
    !anyCursorTooLong && maxCursorLen < 500,
    `max cursor length: ${maxCursorLen} chars (cap is 4000)`,
  );
}

// ---------------------------------------------------------------------
// C. Pool regeneration respects session-excluded ids — once the first
//    pool is exhausted, ids that overlap with what the session already
//    saw are filtered out of the regenerated pool by session exclusion
//    (not by the pool's own internal dedup), while distinct fresh ids
//    in that same regenerated pool are still served normally.
// ---------------------------------------------------------------------
{
  resetShownIds("session-regen");
  // Small pool so it exhausts after just a page or two.
  const pool = buildPool("regen", 8);
  const poolId = createPoolId();
  storePool(poolId, pool);

  let cursorStr: string | null = null;
  let regenerated = false;
  const seenBeforeRegen = new Set<string>();
  let regenPage: ExploreFeedItem[] = [];

  // Drive the small pool to exhaustion (bounded loop — this pool can't
  // take more than a handful of pages), recording every id served
  // along the way. overlappingRegenPool always reuses the exact same
  // "regen-*" ids as the very first pool, plus a fresh batch that
  // changes every call — so once regeneration happens, the overlap
  // portion is a direct, deliberate repeat of ids already in
  // seenBeforeRegen.
  let regenCount = 0;
  const overlappingRegenPool = () => buildOverlappingAndFreshPool("regen", `regen-fresh-${regenCount++}`, 8);

  for (let i = 0; i < 8 && !regenerated; i++) {
    const result = simulateRequest("session-regen", cursorStr, overlappingRegenPool);
    for (const item of result.page) {
      for (const c of item.look.components) {
        if (c.productId) seenBeforeRegen.add(c.productId);
      }
    }
    cursorStr = result.nextCursor;
    if (result.poolExhausted) {
      // This is the request immediately after exhaustion — the one
      // that actually regenerates and is the case under test.
      const next = simulateRequest("session-regen", cursorStr, overlappingRegenPool);
      regenPage = next.page;
      regenerated = true;
    }
  }

  check("pool regenerates when exhausted", regenerated, `regenerated: ${regenerated}`);

  const regenIds = regenPage.flatMap((item) => item.look.components.map((c) => c.productId).filter((id): id is string => Boolean(id)));
  const overlapRepeated = regenIds.filter((id) => seenBeforeRegen.has(id));
  check(
    "the regenerated pool's overlapping ids are excluded by session history, not repeated",
    overlapRepeated.length === 0,
    `repeated overlap ids: ${overlapRepeated.join(", ") || "(none)"}; regenerated page ids: ${regenIds.join(", ")}`,
  );
}

// ---------------------------------------------------------------------
// D. Multi-product looks — dedupeFeedItems drops a whole look if ANY
//    of its components was already shown, and de-dupes within one page.
// ---------------------------------------------------------------------
{
  const alreadyShown = ["shirt-1"];
  const items: ExploreFeedItem[] = [
    fakeFeedItem("look-a", "familiar", ["shirt-1", "pants-1"]), // shirt-1 already shown -> whole look dropped
    fakeFeedItem("look-b", "familiar", ["shirt-2", "pants-2"]), // clean -> kept
    fakeFeedItem("look-c", "familiar", ["shirt-2"]), // repeats look-b's shirt-2 within the same page -> dropped
    fakeFeedItem("look-d", "familiar", ["shirt-3", "shoes-1", "jacket-1"]), // 3-component look, clean -> kept
  ];
  const result = dedupeFeedItems(items, alreadyShown);
  const ids = result.map((i) => i.look.id);
  check(
    "multi-product look dropped when any single component was already shown",
    !ids.includes("look-a"),
    `surviving looks: ${ids.join(", ")}`,
  );
  check(
    "within-page repeat across different looks is caught",
    !ids.includes("look-c"),
    `surviving looks: ${ids.join(", ")}`,
  );
  check(
    "clean single- and multi-component looks both survive",
    ids.includes("look-b") && ids.includes("look-d"),
    `surviving looks: ${ids.join(", ")}`,
  );
  const allSurvivingIds = result.flatMap((i) => i.look.components.map((c) => c.productId));
  check(
    "no duplicate product ids in the final deduped output",
    new Set(allSurvivingIds).size === allSurvivingIds.length,
    `ids: ${allSurvivingIds.join(", ")}`,
  );
}

// ---------------------------------------------------------------------
// E. getShownIds/addShownIds session store — 100+ ids accumulate
//    correctly and are what excludeIds is built from (route.ts).
// ---------------------------------------------------------------------
{
  resetShownIds("session-store");
  for (let batch = 0; batch < 12; batch++) {
    addShownIds(
      "session-store",
      Array.from({ length: 10 }, (_, i) => `batch${batch}-item${i}`),
    );
  }
  const shown = getShownIds("session-store");
  check(
    "session shown-id store accumulates 100+ ids across many small adds",
    shown.length === 120,
    `stored ids: ${shown.length}`,
  );

  // Different sessions never see each other's shown ids.
  resetShownIds("session-other");
  addShownIds("session-other", ["only-in-other"]);
  const isolated = getShownIds("session-store").includes("only-in-other");
  check("sessions are isolated from one another", !isolated, `leaked: ${isolated}`);
}

// ---------------------------------------------------------------------
// F. Pool generation / eBay offset paging — each pool regeneration for
//    a session pages deeper into eBay's result set instead of
//    re-requesting the same top page.
// ---------------------------------------------------------------------
{
  resetPoolGeneration("session-gen");
  const g0 = nextPoolGeneration("session-gen");
  const g1 = nextPoolGeneration("session-gen");
  const g2 = nextPoolGeneration("session-gen");
  check(
    "nextPoolGeneration increments per session, starting at 0",
    g0 === 0 && g1 === 1 && g2 === 2,
    `generations: ${g0}, ${g1}, ${g2}`,
  );

  resetPoolGeneration("session-gen-b");
  const otherFirst = nextPoolGeneration("session-gen-b");
  check(
    "pool generation is isolated per session",
    otherFirst === 0,
    `session-gen-b first generation: ${otherFirst}`,
  );

  // A genuinely brand-new sessionId (no prior resetPoolGeneration —
  // i.e. never seen before, exactly what a fresh page reload gets)
  // must NOT deterministically start at generation 0 every time; that
  // was the actual bug behind "reload -> fresh Explore session, but
  // the same offers as before the reload" — generation 0 always maps
  // to the same eBay offset for the same deterministic generation-0
  // queries. Checked statistically across many distinct fresh
  // sessionIds rather than asserting one exact value.
  const freshStarts = Array.from({ length: 40 }, (_, i) => nextPoolGeneration(`session-fresh-${i}`));
  check(
    "a brand-new session's first pool generation is randomized, not always 0",
    new Set(freshStarts).size > 1,
    `first generations across 40 fresh sessions: ${freshStarts.join(", ")}`,
  );
  check(
    "the randomized starting generation stays within a sane, still-testable range (< computeEbayOffset's 20-generation cap)",
    freshStarts.every((g) => g >= 0 && g < 20),
    `min: ${Math.min(...freshStarts)}, max: ${Math.max(...freshStarts)}`,
  );
  check(
    "a fresh session still increments normally after its randomized start (pagination guarantees untouched)",
    (() => {
      const sid = "session-fresh-increment-check";
      const first = nextPoolGeneration(sid);
      const second = nextPoolGeneration(sid);
      return second === first + 1;
    })(),
    "second call is exactly first+1",
  );

  const offsets = [0, 1, 2, 5].map(computeEbayOffset);
  check(
    "computeEbayOffset pages by 20 items per generation and is strictly increasing",
    JSON.stringify(offsets) === JSON.stringify([0, 20, 40, 100]),
    `offsets: ${offsets.join(", ")}`,
  );
  check(
    "computeEbayOffset is capped rather than growing forever on a very long session",
    computeEbayOffset(1000) === computeEbayOffset(20),
    `offset(1000): ${computeEbayOffset(1000)}, offset(20): ${computeEbayOffset(20)}`,
  );
}

// ---------------------------------------------------------------------
// G. Budget — every range's boundary semantics exactly match the spec:
//    under_100: price<100, 100_200: 100<=price<200, ..., 700_plus:
//    price>=700, no_preference: unconstrained.
// ---------------------------------------------------------------------
{
  const cases: Array<{ range: BudgetRangeId; price: number; expected: boolean; label: string }> = [
    { range: "under_100", price: 99.99, expected: true, label: "under_100 @ 99.99 -> in" },
    { range: "under_100", price: 100, expected: false, label: "under_100 @ 100 -> out (strict <)" },
    { range: "under_100", price: 0, expected: true, label: "under_100 @ 0 -> in" },
    { range: "100_200", price: 99.99, expected: false, label: "100_200 @ 99.99 -> out" },
    { range: "100_200", price: 100, expected: true, label: "100_200 @ 100 -> in (inclusive min)" },
    { range: "100_200", price: 199.99, expected: true, label: "100_200 @ 199.99 -> in" },
    { range: "100_200", price: 200, expected: false, label: "100_200 @ 200 -> out (exclusive max)" },
    { range: "200_400", price: 200, expected: true, label: "200_400 @ 200 -> in" },
    { range: "200_400", price: 400, expected: false, label: "200_400 @ 400 -> out" },
    { range: "200_400", price: 399.99, expected: true, label: "200_400 @ 399.99 -> in" },
    { range: "400_700", price: 400, expected: true, label: "400_700 @ 400 -> in" },
    { range: "400_700", price: 699.99, expected: true, label: "400_700 @ 699.99 -> in" },
    { range: "400_700", price: 700, expected: false, label: "400_700 @ 700 -> out" },
    { range: "700_plus", price: 700, expected: true, label: "700_plus @ 700 -> in" },
    { range: "700_plus", price: 50000, expected: true, label: "700_plus @ 50000 -> in (no upper bound)" },
    { range: "700_plus", price: 699.99, expected: false, label: "700_plus @ 699.99 -> out" },
    { range: "no_preference", price: 1, expected: true, label: "no_preference @ 1 -> in" },
    { range: "no_preference", price: 999999, expected: true, label: "no_preference @ 999999 -> in" },
  ];
  for (const c of cases) {
    check(`budget range boundary — ${c.label}`, isWithinBudget(c.price, c.range) === c.expected, `isWithinBudget(${c.price}, "${c.range}") = ${isWithinBudget(c.price, c.range)}, expected ${c.expected}`);
  }
  // Every declared BudgetRangeId is covered above (fails loudly if a
  // future range is added to types/style.ts without a test case here).
  const covered = new Set(cases.map((c) => c.range));
  check(
    "every BudgetRangeId has boundary coverage",
    BUDGET_RANGES.every((r) => covered.has(r)),
    `covered: ${[...covered].join(", ")}; declared: ${BUDGET_RANGES.join(", ")}`,
  );
  // An unset (null) budget behaves exactly like no_preference — no
  // constraint, same as the featureExtractor's existing soft-scoring
  // treats a null budgetRange as neutral.
  check(
    "unset (null) budgetRange behaves like no_preference",
    isWithinBudget(1, null) === true && isWithinBudget(999999, null) === true,
    `bounds: ${JSON.stringify(budgetBounds(null))}`,
  );
}

// ---------------------------------------------------------------------
// H. filterByBudget — products outside the selected range are rejected
//    from a mixed-price candidate list, INCLUDING exploration-tagged
//    ones (the filter runs on Product[] before classification is even
//    attached, so it can't distinguish/favor exploration — this proves
//    a full mixed-price batch is correctly pruned regardless of what
//    classification it'll later be tagged with).
// ---------------------------------------------------------------------
{
  const products = [
    fakeProduct("cheap-1", 45),
    fakeProduct("mid-1", 150),
    fakeProduct("mid-2", 180),
    fakeProduct("high-1", 900),
    fakeProduct("boundary-low", 100), // exactly at 100_200's min — should survive
    fakeProduct("boundary-high", 200), // exactly at 100_200's max — should be excluded
  ];
  const result = filterByBudget(products, "100_200");
  const ids = result.map((p) => p.id).sort();
  check(
    "filterByBudget keeps only 100_200-range products, respecting inclusive-min/exclusive-max",
    JSON.stringify(ids) === JSON.stringify(["boundary-low", "mid-1", "mid-2"]),
    `kept: ${ids.join(", ")}`,
  );

  // filterByBudget (the strict, classification-unaware function) still
  // rejects everything outside the exact band regardless of tag — it's
  // still what candidateSource.ts uses for familiar/adjacent. The
  // exploration-specific widening lives in
  // filterByBudgetForClassification instead (see test H2 below), not
  // here.
  const explorationBatch = [
    { product: fakeProduct("exp-in-1", 120), classification: "exploration" as const },
    { product: fakeProduct("exp-out-1", 5), classification: "exploration" as const }, // way under 100_200
    { product: fakeProduct("exp-out-2", 900), classification: "exploration" as const }, // way over
    { product: fakeProduct("fam-in-1", 150), classification: "familiar" as const },
  ];
  const surviving = filterByBudget(
    explorationBatch.map((c) => c.product),
    "100_200",
  ).map((p) => p.id);
  check(
    "the strict filterByBudget rejects out-of-band items regardless of tag (it doesn't know about classification at all)",
    JSON.stringify(surviving.sort()) === JSON.stringify(["exp-in-1", "fam-in-1"]),
    `surviving: ${surviving.join(", ")}`,
  );
}

// ---------------------------------------------------------------------
// H2. filterByBudgetForClassification / budgetBoundsForClassification —
//     exploration (only) is allowed to also reach into the previous
//     (one band down, cheaper) segment, per spec: "algorithm should
//     explore from previous price segment". Familiar/adjacent are
//     completely unaffected — still exactly the strict band.
// ---------------------------------------------------------------------
{
  // 100_200's previous band is under_100 (price < 100). So exploration
  // should now accept anything from 0 up to 200 (under_100's floor
  // through 100_200's ceiling), while familiar/adjacent still only
  // accept [100, 200).
  const cases: Array<{ price: number; classification: RecommendationClassification; expected: boolean; label: string }> = [
    { price: 60, classification: "exploration", expected: true, label: "exploration @ 60 (in the previous band) -> in" },
    { price: 60, classification: "familiar", expected: false, label: "familiar @ 60 (below its own band) -> still out" },
    { price: 60, classification: "adjacent", expected: false, label: "adjacent @ 60 (below its own band) -> still out" },
    { price: 150, classification: "exploration", expected: true, label: "exploration @ 150 (in its own band) -> in" },
    { price: 150, classification: "familiar", expected: true, label: "familiar @ 150 (in its own band) -> in" },
    { price: 0, classification: "exploration", expected: true, label: "exploration @ 0 (previous band's floor) -> in" },
    { price: 199.99, classification: "exploration", expected: true, label: "exploration just under 200 -> in" },
    { price: 200, classification: "exploration", expected: false, label: "exploration @ 200 -> still out (never exceeds own band's ceiling)" },
    { price: 900, classification: "exploration", expected: false, label: "exploration way over -> still out" },
  ];
  for (const c of cases) {
    const actual = isWithinBudgetForClassification(c.price, "100_200", c.classification);
    check(`exploration price widening — ${c.label}`, actual === c.expected, `isWithinBudgetForClassification(${c.price}, "100_200", "${c.classification}") = ${actual}, expected ${c.expected}`);
  }

  check(
    "at the lowest band (under_100), exploration has nothing lower to widen into — same as its own strict band",
    isWithinBudgetForClassification(50, "under_100", "exploration") === true &&
      isWithinBudgetForClassification(150, "under_100", "exploration") === false,
    `bounds: ${JSON.stringify(budgetBoundsForClassification("under_100", "exploration"))}`,
  );
  check(
    "no_preference stays fully unconstrained for exploration too (nothing to widen)",
    isWithinBudgetForClassification(1, "no_preference", "exploration") === true &&
      isWithinBudgetForClassification(999999, "no_preference", "exploration") === true,
    `bounds: ${JSON.stringify(budgetBoundsForClassification("no_preference", "exploration"))}`,
  );
  check(
    "an unset (null) budgetRange behaves the same for exploration as for any other classification — unconstrained",
    isWithinBudgetForClassification(1, null, "exploration") === true &&
      isWithinBudgetForClassification(999999, null, "exploration") === true,
    `bounds: ${JSON.stringify(budgetBoundsForClassification(null, "exploration"))}`,
  );

  // filterByBudgetForClassification end-to-end on a mixed batch. Uses
  // 200_400 (not 100_200) here specifically because its previous band
  // (100_200) has a non-zero floor (100) — unlike under_100's floor of
  // 0, this lets us actually test the "below the previous band's
  // floor" rejection case below.
  const widened = filterByBudgetForClassification(
    [fakeProduct("prev-band", 150), fakeProduct("own-band", 350), fakeProduct("too-high", 450), fakeProduct("below-prev-floor", 60)],
    "200_400",
    "exploration",
  ).map((p) => p.id);
  check(
    "filterByBudgetForClassification keeps both the previous band and the own band for exploration, still excludes above the ceiling and below the previous band's floor",
    JSON.stringify(widened.sort()) === JSON.stringify(["own-band", "prev-band"]),
    `kept: ${widened.join(", ")}`,
  );
  const strictSameBatch = filterByBudgetForClassification(
    [fakeProduct("prev-band", 150), fakeProduct("own-band", 350), fakeProduct("too-high", 450), fakeProduct("below-prev-floor", 60)],
    "200_400",
    "familiar",
  ).map((p) => p.id);
  check(
    "the same batch stays strict for familiar (previous band excluded)",
    JSON.stringify(strictSameBatch) === JSON.stringify(["own-band"]),
    `kept: ${strictSameBatch.join(", ")}`,
  );
}

// ---------------------------------------------------------------------
// I. no_preference — multiple price ranges pass through untouched, no
//    bias toward any one band.
// ---------------------------------------------------------------------
{
  const products = [
    fakeProduct("p-cheap", 20),
    fakeProduct("p-low-mid", 130),
    fakeProduct("p-mid", 350),
    fakeProduct("p-high", 600),
    fakeProduct("p-luxury", 2500),
  ];
  const result = filterByBudget(products, "no_preference");
  check(
    "no_preference keeps every price band, none filtered out",
    result.length === products.length,
    `kept ${result.length}/${products.length}: ${result.map((p) => p.price).join(", ")}`,
  );
  const distinctBandsRepresented = new Set([
    result.some((p) => p.price < 100),
    result.some((p) => p.price >= 100 && p.price < 400),
    result.some((p) => p.price >= 400),
  ]);
  check(
    "no_preference output still spans multiple distinct price bands (not narrowed to one)",
    distinctBandsRepresented.size === 1 && distinctBandsRepresented.has(true) && !distinctBandsRepresented.has(false),
    `bands represented: cheap=${result.some((p) => p.price < 100)}, mid=${result.some((p) => p.price >= 100 && p.price < 400)}, high=${result.some((p) => p.price >= 400)}`,
  );
}

// ---------------------------------------------------------------------
// I2. Seller uniqueness — "do not show more than 1 item from the one
//     seller" in a session. filterExcludedSellers is the per-query
//     session-level backstop; dedupeFeedItems's seller-awareness is
//     what also catches two different queries in the same page
//     surfacing the same not-yet-excluded seller.
// ---------------------------------------------------------------------
{
  const sellerProducts = [
    { ...fakeProduct("p1"), seller: { username: "seller-a", feedbackScore: 100, feedbackPercentage: 100 } },
    { ...fakeProduct("p2"), seller: { username: "seller-b", feedbackScore: 100, feedbackPercentage: 100 } },
    { ...fakeProduct("p3"), seller: { username: "seller-a", feedbackScore: 100, feedbackPercentage: 100 } }, // repeats seller-a
    { ...fakeProduct("p4"), seller: null }, // no seller info at all — never excluded by this filter
  ];
  const kept = filterExcludedSellers(sellerProducts, ["seller-a"]).map((p) => p.id);
  check(
    "filterExcludedSellers drops every product from an already-shown seller, keeps others and seller-less products",
    JSON.stringify(kept) === JSON.stringify(["p2", "p4"]),
    `kept: ${kept.join(", ")}`,
  );
  check(
    "filterExcludedSellers is a no-op when nothing's excluded yet",
    filterExcludedSellers(sellerProducts, []).length === sellerProducts.length,
    `length: ${filterExcludedSellers(sellerProducts, []).length}`,
  );

  // dedupeFeedItems: cross-query, same-page collision — two different
  // looks in the SAME batch happen to share a seller neither one had
  // been session-excluded for yet.
  const pageItems = [
    fakeFeedItemWithSellers("look-a", "familiar", [{ productId: "a1", seller: "shared-seller" }]),
    fakeFeedItemWithSellers("look-b", "familiar", [{ productId: "b1", seller: "shared-seller" }]), // same seller as look-a, should be dropped
    fakeFeedItemWithSellers("look-c", "familiar", [{ productId: "c1", seller: "other-seller" }]),
  ];
  const dedupedBySeller = dedupeFeedItems(pageItems, [], []);
  const survivingLookIds = dedupedBySeller.map((i) => i.look.id);
  check(
    "dedupeFeedItems drops a look sharing a seller with an earlier look in the SAME page",
    JSON.stringify(survivingLookIds) === JSON.stringify(["look-a", "look-c"]),
    `surviving looks: ${survivingLookIds.join(", ")}`,
  );

  // dedupeFeedItems: seller already shown in a PREVIOUS page (session
  // history), even though the product id itself is brand new.
  const newProductSameOldSeller = [
    fakeFeedItemWithSellers("look-d", "familiar", [{ productId: "d1-never-shown-before", seller: "already-used-seller" }]),
  ];
  const dedupedAgainstHistory = dedupeFeedItems(newProductSameOldSeller, [], ["already-used-seller"]);
  check(
    "dedupeFeedItems drops a brand-new product if its SELLER was already shown earlier this session",
    dedupedAgainstHistory.length === 0,
    `surviving: ${dedupedAgainstHistory.map((i) => i.look.id).join(", ")}`,
  );

  // A look with no seller info on any component is never dropped by
  // the seller rule (nothing to compare).
  const noSellerLook = [fakeFeedItemWithSellers("look-e", "familiar", [{ productId: "e1", seller: null }])];
  check(
    "a look with no seller info is unaffected by seller-based dedup",
    dedupeFeedItems(noSellerLook, [], ["already-used-seller"]).length === 1,
    `survived: ${dedupeFeedItems(noSellerLook, [], ["already-used-seller"]).length === 1}`,
  );
}

// ---------------------------------------------------------------------
// J. Profile change (budget/style) invalidates the Explore feed.
// ---------------------------------------------------------------------
{
  const base = { budgetRange: "100_200" as BudgetRangeId | null, styleArchetypes: ["minimalist", "classic"] };
  const sigBase = feedProfileSignature(base);

  const sameOrderDifferent = feedProfileSignature({ ...base, styleArchetypes: ["classic", "minimalist"] });
  check(
    "reordering the same style set does NOT count as a change",
    sigBase === sameOrderDifferent,
    `sigBase: ${sigBase}, reordered: ${sameOrderDifferent}`,
  );

  const budgetChanged = feedProfileSignature({ ...base, budgetRange: "400_700" });
  check(
    "changing budget produces a different signature -> resets the feed",
    isFeedInvalidatingChange(sigBase, budgetChanged),
    `sigBase: ${sigBase}, budgetChanged: ${budgetChanged}`,
  );

  const styleChanged = feedProfileSignature({ ...base, styleArchetypes: ["street"] });
  check(
    "changing style produces a different signature -> resets the feed",
    isFeedInvalidatingChange(sigBase, styleChanged),
    `sigBase: ${sigBase}, styleChanged: ${styleChanged}`,
  );

  const unchanged = feedProfileSignature({ ...base });
  check(
    "an identical profile does NOT trigger a reset",
    !isFeedInvalidatingChange(sigBase, unchanged),
    `sigBase: ${sigBase}, unchanged: ${unchanged}`,
  );

  check(
    "the initial hydration transition (prev=null) is never treated as a change",
    !isFeedInvalidatingChange(null, sigBase) && !isFeedInvalidatingChange(sigBase, null),
    `null -> sig: ${isFeedInvalidatingChange(null, sigBase)}, sig -> null: ${isFeedInvalidatingChange(sigBase, null)}`,
  );

  check(
    "a profile with no budget/style set (never onboarded) has a stable, comparable signature",
    feedProfileSignature(null) === feedProfileSignature({ budgetRange: null, styleArchetypes: [] }),
    `null profile: ${feedProfileSignature(null)}`,
  );
}

// ---------------------------------------------------------------------
// K. Prefetch trigger — starts loading ~2–3 viewport heights before the
//    end of loaded content, never waiting for the literal bottom.
// ---------------------------------------------------------------------
{
  const viewport = 800;
  check(
    "sentinel 1 viewport away -> already within the 2–3 viewport window, prefetch triggers",
    shouldPrefetch(viewport * 1, viewport, 2.5),
    `distance=${viewport}, viewport=${viewport}`,
  );
  check(
    "sentinel exactly 2.5 viewports away -> prefetch starts",
    shouldPrefetch(viewport * 2.5, viewport, 2.5),
    `distance=${viewport * 2.5}, viewport=${viewport}`,
  );
  check(
    "sentinel 2 viewports away (within the 2-3 window) -> prefetch starts",
    shouldPrefetch(viewport * 2, viewport, 2.5),
    `distance=${viewport * 2}, viewport=${viewport}`,
  );
  check(
    "sentinel already on screen (distance<=0) -> prefetch starts (never waits for literal bottom)",
    shouldPrefetch(0, viewport, 2.5) && shouldPrefetch(-50, viewport, 2.5),
    `distance=0 and -50 both trigger`,
  );
  check(
    "sentinel far away (5 viewports) -> no prefetch yet",
    !shouldPrefetch(viewport * 5, viewport, 2.5),
    `distance=${viewport * 5}, viewport=${viewport}`,
  );
}

// ---------------------------------------------------------------------
// N. Query diversity across pool generations — reduces how often
//    recycling ever has to engage by making a regenerated pool tap
//    genuinely different search terms (not just a deeper eBay offset
//    into the same terms). This is the direct response to "I shouldn't
//    use the same seeder multiple times in the feed".
// ---------------------------------------------------------------------
{
  // rotate() itself: pure cyclic shift.
  check(
    "rotate shifts by the given amount",
    JSON.stringify(rotate([1, 2, 3, 4], 1)) === JSON.stringify([2, 3, 4, 1]),
    `rotate([1,2,3,4], 1) = ${JSON.stringify(rotate([1, 2, 3, 4], 1))}`,
  );
  check(
    "rotate wraps around (by >= length)",
    JSON.stringify(rotate([1, 2, 3], 4)) === JSON.stringify([2, 3, 1]),
    `rotate([1,2,3], 4) = ${JSON.stringify(rotate([1, 2, 3], 4))}`,
  );
  check(
    "rotate handles 0 (no-op) and empty arrays without throwing",
    JSON.stringify(rotate([1, 2, 3], 0)) === JSON.stringify([1, 2, 3]) && JSON.stringify(rotate([], 5)) === JSON.stringify([]),
    `rotate([1,2,3], 0) = ${JSON.stringify(rotate([1, 2, 3], 0))}, rotate([], 5) = ${JSON.stringify(rotate([], 5))}`,
  );

  // buildCandidateQueries: same context, different poolGeneration ->
  // a genuinely different query set (not just the same terms).
  const baseContext = {
    profile: { styleArchetypes: ["minimalist"] as StyleArchetypeId[], budgetRange: null, preferredBrands: [], dislikedBrands: [], preferredColors: [], dislikedColors: [] },
    behavioral: createEmptyBehavioralPreferences(),
    location: { latitude: null, longitude: null, timezone: null },
    weather: null,
    temporal: null,
    budgetRange: null as BudgetRangeId | null,
    intent: null,
    mood: null,
    excludeIds: [] as string[],
    excludeSellers: [] as string[],
    sessionId: "test-session",
    mix: DEFAULT_RECOMMENDATION_MIX,
  };

  const gen0Queries = buildCandidateQueries({ ...baseContext, poolGeneration: 0 }).map((q) => q.text);
  const gen1Queries = buildCandidateQueries({ ...baseContext, poolGeneration: 1 }).map((q) => q.text);

  check(
    "a different pool generation produces a genuinely different query set for the same context",
    JSON.stringify(gen0Queries) !== JSON.stringify(gen1Queries),
    `gen0: ${gen0Queries.join(", ")}\n  gen1: ${gen1Queries.join(", ")}`,
  );
  check(
    "generation 0 is still deterministic (same context+generation -> same queries, cache-friendly)",
    JSON.stringify(gen0Queries) === JSON.stringify(buildCandidateQueries({ ...baseContext, poolGeneration: 0 }).map((q) => q.text)),
    `gen0 (twice): ${gen0Queries.join(", ")}`,
  );

  // The exploration query specifically should range across multiple
  // different unexplored archetypes as generation advances, not repeat
  // the same one every time.
  const explorationTermsAcrossGenerations = new Set(
    Array.from({ length: 8 }, (_, gen) =>
      buildCandidateQueries({ ...baseContext, poolGeneration: gen }).find((q) => q.classification === "exploration")?.text,
    ),
  );
  check(
    "the exploration term varies across generations rather than always picking the same archetype",
    explorationTermsAcrossGenerations.size > 1,
    `exploration terms seen across 8 generations: ${[...explorationTermsAcrossGenerations].join(", ")}`,
  );
}

// ---------------------------------------------------------------------
// M. Recycle-when-exhausted — the feed never dead-ends into "You're all
//    caught up" just because a finite pool (e.g. eBay Sandbox's small
//    test inventory) has been fully seen; it recycles already-shown
//    looks (reshuffled) instead, and hasMore stays true. The one real
//    stop condition — the freshly generated pool having zero candidates
//    at all — still correctly reports hasMore:false.
// ---------------------------------------------------------------------
{
  // shuffle() preserves the exact same items, only reorders them.
  const original = Array.from({ length: 30 }, (_, i) => i);
  const shuffled = shuffle(original);
  check(
    "shuffle keeps the same multiset of items",
    JSON.stringify([...shuffled].sort((a, b) => a - b)) === JSON.stringify(original),
    `shuffled: ${shuffled.join(",")}`,
  );
  // Not a hard guarantee for any single call, but with 30 distinct
  // items the odds of an unchanged order are astronomically small —
  // good enough to catch a shuffle() that's actually a no-op.
  check(
    "shuffle actually reorders (not a no-op) on a large enough input",
    shuffled.join(",") !== original.join(","),
    `shuffled: ${shuffled.join(",")}`,
  );

  resetShownIds("session-recycle");
  resetPoolGeneration("session-recycle");
  // A small pool so it's realistic to exhaust entirely within a
  // handful of pages, standing in for eBay Sandbox's limited catalog
  // for a narrow budget/style combination.
  const smallPool = buildPool("recycle", 6); // ~6 familiar (12 products) + adjacent + exploration
  const poolId = createPoolId();
  storePool(poolId, smallPool);

  let cursorStr: string | null = null;
  let everReportedNoMore = false;
  let sawRecycledPage = false;
  for (let i = 0; i < 25; i++) {
    const result = simulateRequest("session-recycle", cursorStr, () => buildPool("recycle", 6));
    if (!result.hasMore) everReportedNoMore = true;
    if (result.recycled) sawRecycledPage = true;
    cursorStr = result.nextCursor;
  }
  check(
    "a finite pool that's been fully seen never reports hasMore:false (no premature 'caught up')",
    !everReportedNoMore,
    `everReportedNoMore: ${everReportedNoMore}`,
  );
  check(
    "the recycle fallback actually engaged once the small pool ran dry",
    sawRecycledPage,
    `sawRecycledPage: ${sawRecycledPage}`,
  );

  // The one legitimate stop condition: a freshly (re)generated pool
  // with literally zero candidates (e.g. eBay unavailable) still ends
  // the feed rather than looping forever on nothing.
  resetShownIds("session-dead-ebay");
  resetPoolGeneration("session-dead-ebay");
  const emptyResult = simulateRequest("session-dead-ebay", null, () => partitionByClassification([]));
  check(
    "a genuinely empty pool (e.g. eBay down) still correctly reports hasMore:false",
    emptyResult.hasMore === false && emptyResult.page.length === 0,
    `hasMore: ${emptyResult.hasMore}, page.length: ${emptyResult.page.length}`,
  );
}

// ---------------------------------------------------------------------
// O. Session freshness on reload vs. preserved state on in-app
//    navigation (task: "browser reload -> fresh feed, but without a
//    long freeze" + "Explore -> Product -> Back restores the same
//    session"). No browser/DOM available in this script, so — like
//    the source-inspection checks in verify-session7.ts — this
//    verifies the actual implementation file rather than reimplementing
//    the behavior in a mock.
// ---------------------------------------------------------------------
{
  const sessionSource = readFileSync(path.join(__dirname, "..", "src", "lib", "explore", "session.tsx"), "utf8");
  check(
    "a fresh mount never restores a previous feed's items from storage (the actual reload bug this fixes)",
    !/saved\.items/.test(sessionSource) && !/sessionStorage\.getItem\(.compass-explore-session/.test(sessionSource),
    "no sessionStorage-backed item restoration remains in session.tsx",
  );
  check(
    "every provider mount starts from initialState() (fresh sessionId, empty items) rather than merging in old state",
    /useState<ExploreState>\(initialState\)/.test(sessionSource) &&
      /function initialState\(\): ExploreState \{[\s\S]{0,200}const sessionId = createSessionId\(\)/.test(sessionSource),
    "initialState() unconditionally builds a blank session",
  );
  check(
    "ExploreFeedProvider is only ever mounted from the single root layout, never a nested layout/route group",
    (() => {
      // This is the actual invariant "reload -> new session, in-app
      // nav -> same session" rests on: a component only remounts when
      // its position in the tree unmounts, and Next.js App Router only
      // shares a layout's mounted state along routes that share that
      // layout in their tree. If the provider ever moved into a
      // nested layout that doesn't cover every route (e.g. a
      // (tabs)/layout.tsx that /product or /look sit outside of),
      // navigating there would unmount it and silently reintroduce a
      // reset-on-navigation bug with no code change to session.tsx
      // itself — so this checks the actual file layout, not just
      // session.tsx's own source.
      const appDir = path.join(__dirname, "..", "src", "app");
      const layoutFiles: string[] = [];
      const walk = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (entry.name === "layout.tsx") layoutFiles.push(full);
        }
      };
      walk(appDir);
      return layoutFiles.length === 1 && readFileSync(layoutFiles[0], "utf8").includes("<ExploreFeedProvider>");
    })(),
    "exactly one layout.tsx exists under src/app, and it renders <ExploreFeedProvider>",
  );
  check(
    "loadInitial() fires immediately once the profile hydrates (no artificial wait for a fully-formed pool)",
    /if \(prev === null\) \{[\s\S]{0,300}void loadInitial\(\);/.test(sessionSource),
    "the first profile-signature hydration kicks loadInitial() directly",
  );
  check(
    "scroll anchor is plain React state (setScrollAnchor), not round-tripped through sessionStorage",
    /const setScrollAnchor = useCallback/.test(sessionSource) && !/sessionStorage\.setItem/.test(sessionSource),
    "setScrollAnchor updates context state directly",
  );

  const exploreFeedSource2 = readFileSync(path.join(__dirname, "..", "src", "components", "explore", "ExploreFeed.tsx"), "utf8");
  check(
    "captureFeedPosition (Explore -> Product/Look) updates the shared anchor via context, not sessionStorage",
    /setScrollAnchor\(anchorId, anchorOffset\)/.test(exploreFeedSource2) &&
      !/sessionStorage\.(setItem|getItem)/.test(exploreFeedSource2),
    "captureFeedPosition calls setScrollPosition + setScrollAnchor only",
  );
  check(
    "the restore effect no-ops when there's nothing to restore (fresh session / direct Product visit never yanks scroll around)",
    /if \(restoredRef\.current \|\| items\.length === 0\) return;/.test(exploreFeedSource2),
    "restore effect is guarded on items.length === 0",
  );
  check(
    "scroll position + anchor are tracked by exactly ONE always-on listener, not duplicated across two effects",
    (exploreFeedSource2.match(/setScrollPosition\(window\.scrollY\)/g) ?? []).length === 1,
    "prevents the M13 regression where a second, hasMore-gated tracker silently stopped updating the anchor once the feed ran out",
  );
  check(
    "position/anchor tracking is NOT gated behind hasMore — leaving Explore must still have something fresh to restore even if the feed happened to run dry",
    (() => {
      const trackerEffect = exploreFeedSource2.match(/useEffect\(\(\) => \{[\s\S]*?setScrollAnchor\(anchorId, anchorOffset\);[\s\S]*?\}, \[setScrollPosition, setScrollAnchor\]\);/);
      return Boolean(trackerEffect) && !/if \(!hasMore/.test(trackerEffect![0]);
    })(),
    "the position/anchor effect's own dependency array is [setScrollPosition, setScrollAnchor] — separate from the hasMore-gated prefetch effect",
  );
}


//    call made while one is in flight is dropped, not queued or
//    restarted, and the guard releases correctly so a later call (after
//    the first finishes) goes through normally.
// ---------------------------------------------------------------------
// Wrapped in an async IIFE (rather than top-level await) since this
// script is transpiled to CJS.
void (async () => {
  const guard = new SingleFlightGuard();
  let underlyingCalls = 0;
  let resolveFirst: (() => void) | null = null;
  const slowFetch = () =>
    new Promise<string>((resolve) => {
      underlyingCalls++;
      resolveFirst = () => resolve("page-1");
    });

  const firstCall = guard.run(slowFetch);
  check("guard reports in-flight while the first call is still pending", guard.isInFlight, `isInFlight: ${guard.isInFlight}`);

  // Two more calls arrive while the first is still unresolved — both
  // must be dropped (return null) rather than issuing a second/third
  // underlying request.
  const secondCall = await guard.run(slowFetch);
  const thirdCall = await guard.run(slowFetch);
  check(
    "concurrent calls while in flight are dropped (return null), no extra underlying call",
    secondCall === null && thirdCall === null && underlyingCalls === 1,
    `secondCall: ${secondCall}, thirdCall: ${thirdCall}, underlyingCalls: ${underlyingCalls}`,
  );

  resolveFirst!();
  const firstResult = await firstCall;
  check("the original in-flight call resolves normally", firstResult === "page-1", `firstResult: ${firstResult}`);
  check("guard releases once the call settles", !guard.isInFlight, `isInFlight: ${guard.isInFlight}`);

  // After release, a new call is a genuinely new (non-dropped) request
  // — checked via its return value, not the slowFetch-specific counter.
  const fourthCall = await guard.run(async () => "page-2");
  check(
    "after release, the next call goes through normally (not dropped)",
    fourthCall === "page-2",
    `fourthCall: ${fourthCall}`,
  );

  console.log(`\n${failures === 0 ? "All Explore pagination checks passed." : `${failures} check(s) FAILED.`}`);
  process.exit(failures === 0 ? 0 : 1);
})();
