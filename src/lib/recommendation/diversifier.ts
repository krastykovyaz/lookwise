import "server-only";
import type { ExploreFeedItem, RecommendationCandidate, RecommendationContext } from "@/types/explore";

export interface Diversifier {
  diversify(candidates: RecommendationCandidate[], context: RecommendationContext): RecommendationCandidate[];
}

const WINDOW = 3;

// Greedy re-ranking: walk the ranked list, and each time a candidate
// would make brand/category/bucket repeat within the last WINDOW picks,
// push it down by its repetitionPenalty and re-consider. This keeps the
// result "relevant + diverse" (section 11) rather than randomly
// shuffled — a candidate never drops below a much lower-scoring one just
// to force variety.
class DefaultDiversifier implements Diversifier {
  diversify(candidates: RecommendationCandidate[], context: RecommendationContext): RecommendationCandidate[] {
    void context;
    const remaining = [...candidates];
    const placed: RecommendationCandidate[] = [];

    while (remaining.length > 0) {
      let bestIndex = 0;
      let bestAdjusted = -Infinity;

      for (let i = 0; i < remaining.length; i++) {
        const candidate = remaining[i];
        const recent = placed.slice(-WINDOW);
        const brandRepeats = recent.filter(
          (p) => p.product.brand && p.product.brand === candidate.product.brand,
        ).length;
        const categoryRepeats = recent.filter((p) => p.bucket === candidate.bucket).length;
        const repetitionPenalty = brandRepeats * 0.35 + categoryRepeats * 0.15;
        const adjusted = (candidate.score?.totalScore ?? 0) - repetitionPenalty;

        if (adjusted > bestAdjusted) {
          bestAdjusted = adjusted;
          bestIndex = i;
        }
      }

      const [chosen] = remaining.splice(bestIndex, 1);
      const recentAtChoice = placed.slice(-WINDOW);
      const repetitionPenalty =
        recentAtChoice.filter((p) => p.product.brand && p.product.brand === chosen.product.brand).length * 0.35 +
        recentAtChoice.filter((p) => p.bucket === chosen.bucket).length * 0.15;

      placed.push({
        ...chosen,
        score: chosen.score ? { ...chosen.score, repetitionPenalty } : chosen.score,
      });
    }

    return placed;
  }
}

export const diversifier: Diversifier = new DefaultDiversifier();

// Section 9: "make sure [diversity] actually operates AFTER ranking and
// mix selection." diversifier.diversify() above already runs on the raw
// candidate pool before looks are assembled (useful for outfit variety
// within the pool). This second, lightweight pass reorders an already
// mix-selected *page* of feed cards — a pure permutation, so it never
// changes which looks are on the page or breaks the familiar/adjacent/
// exploration quota mixSelector just enforced; it only fixes the
// display order so the same brand/bucket doesn't repeat back-to-back
// when the pool happens to have several similar items in a row.
const PAGE_WINDOW = 2;

export function diversifyFeedPage(items: ExploreFeedItem[]): ExploreFeedItem[] {
  const remaining = [...items];
  const placed: ExploreFeedItem[] = [];

  const primaryBrand = (item: ExploreFeedItem) => item.look.components[0]?.product?.brand ?? null;
  const primaryBucket = (item: ExploreFeedItem) => item.look.components[0]?.role ?? null;

  while (remaining.length > 0) {
    let bestIndex = 0;
    let bestPenalty = Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i];
      const recent = placed.slice(-PAGE_WINDOW);
      const brand = primaryBrand(candidate);
      const bucket = primaryBucket(candidate);
      const brandRepeats = brand ? recent.filter((p) => primaryBrand(p) === brand).length : 0;
      const bucketRepeats = bucket ? recent.filter((p) => primaryBucket(p) === bucket).length : 0;
      const penalty = brandRepeats * 2 + bucketRepeats;
      // Ties keep original (already ranked) order — only pushes a card
      // back when it would genuinely repeat something recent.
      if (penalty < bestPenalty) {
        bestPenalty = penalty;
        bestIndex = i;
      }
    }

    placed.push(remaining.splice(bestIndex, 1)[0]);
  }

  return placed;
}
