import "server-only";
import type { RecommendationCandidate, RecommendationContext } from "@/types/explore";
import { RANKING_WEIGHTS } from "@/lib/recommendation/config";

export interface Ranker {
  rank(candidates: RecommendationCandidate[], context: RecommendationContext): RecommendationCandidate[];
}

// finalScore = sum(component * weight) - penalties * weight
// (section 2 — weights come from RANKING_WEIGHTS so they're tunable in
// one place without touching this formula).
function totalScore(candidate: RecommendationCandidate): number {
  const s = candidate.score;
  if (!s) return 0;
  const w = RANKING_WEIGHTS;
  return (
    s.styleMatch * w.styleMatch +
    s.contextMatch * w.contextMatch +
    s.preferenceMatch * w.preferenceMatch +
    s.budgetMatch * w.budgetMatch +
    s.weatherMatch * w.weatherMatch +
    s.quality * w.quality +
    s.freshness * w.freshness +
    s.explorationBonus * w.explorationBonus -
    s.repetitionPenalty * w.repetitionPenalty -
    s.dislikePenalty * w.dislikePenalty
  );
}

class DefaultRanker implements Ranker {
  rank(candidates: RecommendationCandidate[], context: RecommendationContext): RecommendationCandidate[] {
    void context; // ranking itself is a pure function of each candidate's score
    const scored = candidates.map((candidate) => {
      if (!candidate.score) return candidate;
      return { ...candidate, score: { ...candidate.score, totalScore: totalScore(candidate) } };
    });
    return scored.sort((a, b) => (b.score?.totalScore ?? 0) - (a.score?.totalScore ?? 0));
  }
}

export const ranker: Ranker = new DefaultRanker();
