import "server-only";
import type { RecommendationCandidate, RecommendationContext, RecommendationClassification } from "@/types/explore";
import { categorizeProduct } from "@/lib/recommendation/categorize";
import { ebayCandidateSource, buildCandidateQueries, type CandidateSource } from "@/lib/recommendation/candidateSource";

export interface CandidateGenerator {
  generateCandidates(context: RecommendationContext): Promise<RecommendationCandidate[]>;
}

// Target pool size — a batch (section 8: "20–40 candidates"), never a
// bulk eBay request.
const MIN_POOL_SIZE = 20;
const MAX_POOL_SIZE = 40;

class DefaultCandidateGenerator implements CandidateGenerator {
  constructor(private sources: CandidateSource[] = [ebayCandidateSource]) {}

  async generateCandidates(context: RecommendationContext): Promise<RecommendationCandidate[]> {
    const queries = buildCandidateQueries(context);
    const raw = (
      await Promise.all(this.sources.map((source) => source.fetch(queries, context)))
    ).flat();

    // Dedupe by product id (a query can legitimately return the same
    // item as another query).
    const seen = new Set<string>();
    const deduped = raw.filter(({ product }) => {
      if (seen.has(product.id)) return false;
      seen.add(product.id);
      return true;
    });

    const tagged = deduped.map((entry) => ({
      product: entry.product,
      bucket: categorizeProduct(entry.product),
      sourceQuery: entry.sourceQuery,
      classification: entry.classification,
    }));

    // Preserve all three recommendation buckets before applying the pool cap.
    // A familiar-heavy eBay response must not crowd adjacent/exploration
    // candidates out before mixSelector gets a chance to enforce 70/20/10.
    const byClassification: Record<RecommendationClassification, RecommendationCandidate[]> = {
      familiar: [],
      adjacent: [],
      exploration: [],
    };
    for (const candidate of tagged) byClassification[candidate.classification].push(candidate);

    const target: Record<RecommendationClassification, number> = { familiar: 28, adjacent: 8, exploration: 4 };
    const candidates: RecommendationCandidate[] = [];
    for (const classification of ["familiar", "adjacent", "exploration"] as const) {
      candidates.push(...byClassification[classification].slice(0, target[classification]));
    }

    // Graceful fill when one classification has fewer results.
    if (candidates.length < MAX_POOL_SIZE) {
      for (const classification of ["familiar", "adjacent", "exploration"] as const) {
        for (const candidate of byClassification[classification].slice(target[classification])) {
          if (candidates.length >= MAX_POOL_SIZE) break;
          candidates.push(candidate);
        }
        if (candidates.length >= MAX_POOL_SIZE) break;
      }
    }

    if (candidates.length < MIN_POOL_SIZE) {
      // Not an error — Sandbox inventory or a narrow query set can
      // legitimately return fewer. The ranker/diversifier work fine with
      // a smaller pool; the feed just won't paginate as far before a
      // fresh pool has to be generated.
      console.warn(
        `[Compass] Explore candidate pool smaller than target: ${candidates.length}/${MIN_POOL_SIZE}`,
      );
    }

    return candidates;
  }
}

export const candidateGenerator: CandidateGenerator = new DefaultCandidateGenerator();
