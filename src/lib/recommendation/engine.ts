import "server-only";
import type { RecommendationContext, RecommendationResult } from "@/types/explore";
import { candidateGenerator } from "@/lib/recommendation/candidateGenerator";
import { featureExtractor } from "@/lib/recommendation/featureExtractor";
import { ranker } from "@/lib/recommendation/ranker";
import { diversifier, diversifyFeedPage } from "@/lib/recommendation/diversifier";
import { assembleLooks } from "@/lib/recommendation/lookAssembler";
import { encodeCursor, getPool, storePool, createPoolId, nextPoolGeneration, type ExploreCursor } from "@/lib/recommendation/pool";
import { emptyOffsets, isPoolExhausted, partitionByClassification, selectMixedPage } from "@/lib/recommendation/mixSelector";

export interface RecommendationEngine {
  getFeed(context: RecommendationContext, cursor: ExploreCursor | null, debug: boolean): Promise<RecommendationResult>;
}

const PAGE_SIZE = 10;

// Pure, exported, and deterministic-shape (only the order changes) so
// it's directly unit-testable — see scripts/verify-explore-pagination.ts.
// Used only for the recycle-when-exhausted fallback above, so repeated
// passes over the same finite pool don't render in the exact same
// sequence every time.
export function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Drops any feed item that repeats a product id already in
// `alreadyShown`, and also guards against two items *within the same
// page* sharing a product id (e.g. the same item surfacing as both a
// spotlight card and a component of an assembled look). Also enforces
// "at most 1 item per seller per session" the same way — a look
// containing a component from a seller already in `alreadyShownSellers`
// (or already used earlier in this same page) is dropped, not just
// trimmed, since partially replacing one component of an already-
// assembled/scored look isn't something this pass can do safely. Pure
// and exported so it's directly unit-testable — see
// scripts/verify-explore-pagination.ts.
export function dedupeFeedItems(
  items: RecommendationResult["items"],
  alreadyShown: string[],
  alreadyShownSellers: string[] = [],
) {
  const seenIds = new Set(alreadyShown);
  const seenSellers = new Set(alreadyShownSellers);
  const result: RecommendationResult["items"] = [];
  for (const item of items) {
    const ids = item.look.components.map((c) => c.productId).filter((id): id is string => Boolean(id));
    const sellers = item.look.components
      .map((c) => c.product?.seller?.username)
      .filter((s): s is string => Boolean(s));
    if (ids.some((id) => seenIds.has(id))) continue;
    if (sellers.some((s) => seenSellers.has(s))) continue;
    for (const id of ids) seenIds.add(id);
    for (const s of sellers) seenSellers.add(s);
    result.push(item);
  }
  return result;
}

// The first implementation is rule-based end to end (section 3 of the
// original Explore milestone: "Do not implement machine learning yet").
// Every stage is swappable via its own interface, so a future learned
// Ranker or embeddings-based CandidateGenerator can replace one piece
// without touching this orchestration or the /api/explore route.
//
// Pipeline order (section 1 of the V0.1 upgrade):
//   rank candidates -> classify (already tagged during generation) ->
//   assemble into looks -> partition into familiar/adjacent/exploration
//   buckets -> select this page by quota (mixSelector) -> diversify the
//   selected page's display order (diversifier.diversifyFeedPage) ->
//   return.
class RuleBasedRecommendationEngine implements RecommendationEngine {
  async getFeed(
    context: RecommendationContext,
    cursor: ExploreCursor | null,
    debug: boolean,
  ): Promise<RecommendationResult> {
    // Wrapped in a bounded retry loop (section 8: "no infinite API
    // request loop", capped — not open-ended). Previously, once a
    // pool's current offset window AND the rest of the pool were both
    // fully shown, this returned hasMore:false immediately while
    // separately preparing a fresh pool "for the next request" — but
    // the client (ExploreFeed.tsx) stops calling loadMore() forever
    // the moment hasMore is false, so that next request never
    // actually happened and the feed stopped prematurely even though
    // a deeper pool (more eBay pages, further-rotated queries — see
    // candidateSource.ts) would very likely have had fresh items. Now
    // an exhausted pool is regenerated and retried within the SAME
    // request, up to MAX_POOL_ATTEMPTS times, before ever telling the
    // client to stop.
    const MAX_POOL_ATTEMPTS = 3;
    let poolId: string | null = cursor?.poolId ?? null;
    let offsets = cursor?.offsets ?? emptyOffsets();
    let pool = cursor ? getPool(cursor.poolId) : undefined;

    let page: RecommendationResult["items"] = [];
    let nextOffsets = offsets;
    let poolExhausted = false;

    for (let attempt = 0; attempt < MAX_POOL_ATTEMPTS; attempt++) {
      if (!pool) {
        // No cursor, or the pool expired/was consumed/was just
        // exhausted by a previous iteration of this loop — generate a
        // fresh one. excludeIds carries forward so a regenerated pool
        // doesn't immediately repeat what the session already saw
        // (section 7/8). poolGeneration is set here (not by the
        // caller) since it must reflect exactly how many pools this
        // session has created so far — candidateSource.ts uses it to
        // page deeper into eBay's result set each time, instead of
        // re-fetching the same top page that's now mostly
        // already-shown.
        const generationContext: RecommendationContext = {
          ...context,
          poolGeneration: nextPoolGeneration(context.sessionId),
        };
        const candidates = await candidateGenerator.generateCandidates(generationContext);
        const scored = featureExtractor.extract(candidates, generationContext);
        // diversifier.diversify still runs here, on the raw candidate
        // pool before assembly — it keeps any one bucket (e.g. a run
        // of same-brand footwear, common in eBay Sandbox) from
        // monopolizing which candidates get picked as outfit
        // anchors/fillers.
        const rankedThenDiversified = diversifier.diversify(ranker.rank(scored, generationContext), generationContext);
        const assembled = assembleLooks(rankedThenDiversified, generationContext, debug);
        pool = partitionByClassification(assembled);
        poolId = createPoolId();
        storePool(poolId, pool);
        offsets = emptyOffsets();

        // A freshly generated pool with genuinely zero candidates at
        // all (e.g. eBay down, or this attempt's deeper query truly
        // found nothing) is the one legitimate stop condition — no
        // amount of further regeneration attempts will produce
        // anything from an upstream source that returned nothing.
        if (pool.familiar.length === 0 && pool.adjacent.length === 0 && pool.exploration.length === 0) {
          poolExhausted = true;
          break;
        }
      }

      const selected = selectMixedPage(pool, offsets, context.mix, PAGE_SIZE);
      const diversifiedPage = diversifyFeedPage(selected.page);
      nextOffsets = selected.offsets;

      // Final defensive dedup (section: "final deduplication step
      // before returning the feed"). context.excludeIds is the
      // session's full shown-id history (see route.ts), so this also
      // catches the case where a regenerated pool's candidate fetch
      // raced with another request for the same session. Offsets
      // above are computed from the *undeduped* selection, so
      // pagination position is unaffected — this only ever removes
      // items, never causes the same slice to be reconsidered on the
      // next page.
      page = dedupeFeedItems(diversifiedPage, context.excludeIds, context.excludeSellers);

      // The offset-window slice above can come back entirely
      // already-shown even while the pool as a whole still has fresh
      // candidates further in (e.g. a regenerated pool overlapping
      // earlier ones at the front of a bucket). Before giving up on
      // this pool, scan the whole thing for anything not yet shown
      // rather than immediately regenerating.
      if (page.length === 0 && selected.page.length > 0) {
        const wholePool = [...pool.familiar, ...pool.adjacent, ...pool.exploration];
        const freshFromWholePool = dedupeFeedItems(wholePool, context.excludeIds, context.excludeSellers).slice(0, PAGE_SIZE);
        if (freshFromWholePool.length > 0) {
          page = diversifyFeedPage(freshFromWholePool);
        }
      }

      poolExhausted = isPoolExhausted(pool, nextOffsets);

      if (page.length > 0) break; // got a real page — done

      // This pool (current offsets AND the whole pool) had nothing
      // fresh left. Drop it and let the next loop iteration generate
      // a deeper one instead of surfacing hasMore:false here — see
      // the comment above MAX_POOL_ATTEMPTS.
      pool = undefined;
      poolId = null;
    }

    // The cursor only ever carries poolId + offsets — never shown/
    // excluded ids. Those live server-side keyed by sessionId (see
    // getShownIds/addShownIds in pool.ts) and are looked up fresh on
    // every request, so the cursor stays a few dozen bytes no matter
    // how many pages a session has paged through.
    const nextCursor = encodeCursor({
      poolId: poolExhausted || !poolId ? createPoolId() : poolId,
      offsets: poolExhausted || !poolId ? emptyOffsets() : nextOffsets,
    });

    return {
      items: page,
      nextCursor,
      // Only false once MAX_POOL_ATTEMPTS consecutive fresh pools in
      // a row all came back empty (or a freshly generated pool had
      // zero candidates at all) — i.e. eBay is genuinely not
      // returning anything new even several pages/rotations deeper.
      // That tells the client to stop asking rather than looping on
      // empty requests (section 8: "no infinite API request loop").
      hasMore: page.length > 0,
    };
  }
}

export const recommendationEngine: RecommendationEngine = new RuleBasedRecommendationEngine();
