import "server-only";
import { DEFAULT_RECOMMENDATION_MIX, type RecommendationMix } from "@/types/explore";

// The target familiar/adjacent/exploration split for every normal
// feed batch (not just the pool as a whole) — see mixSelector.ts for
// how this is enforced per page rather than merely used as a label.
// Re-exported here under the name the spec asks for; the value itself
// still lives in types/explore.ts next to the RecommendationMix type
// (this project's convention — see STYLE_ARCHETYPES/BUDGET_RANGE_BOUNDS
// in types/style.ts — is that a types/*.ts file can also hold the
// canonical default value for its own type).
export const RECOMMENDATION_MIX: RecommendationMix = DEFAULT_RECOMMENDATION_MIX;

// Weights applied to each 0–1 feature-extractor component before they're
// summed into a candidate's totalScore (see ranker.ts). Values are hand
// -picked to be "reasonable", not tuned against real engagement data —
// that's the whole point of pulling them out here instead of leaving
// them inline: a future experiment can swap this object (or make it
// per-user) without touching the Ranker's logic.
//
// Rough intent behind the relative sizes:
//  - preferenceMatch is weighted highest: what someone has actually
//    liked/saved/opened is the strongest signal we have.
//  - styleMatch and budgetMatch are close behind — explicit profile
//    signals the user gave us directly.
//  - contextMatch/weatherMatch matter but shouldn't outrank taste
//    (section 4: "must NOT dominate style").
//  - quality and freshness are tie-breakers, not primary drivers.
//  - explorationBonus is deliberately small — it nudges the exploration
//    slice's ranking, it doesn't need to; the mix quota (not score) is
//    what actually guarantees exploration items appear.
//  - penalties (dislikePenalty, repetitionPenalty) are weighted >=1 so
//    an explicit or strongly-inferred dislike reliably drags a score
//    down rather than just nudging it.
export const RANKING_WEIGHTS = {
  styleMatch: 1.0,
  contextMatch: 0.7,
  preferenceMatch: 1.2,
  budgetMatch: 0.9,
  weatherMatch: 0.7,
  quality: 0.5,
  freshness: 0.6,
  explorationBonus: 0.6,
  repetitionPenalty: 1.0,
  dislikePenalty: 1.3,
} as const;

export type RankingWeightKey = keyof typeof RANKING_WEIGHTS;

// Weights for the outfit-compatibility score used by the look assembler
// (section 5/6) when choosing which candidate best complements an
// anchor product. Color is weighted highest since it's the most
// visible/obvious signal a real "does this go together" check would
// use; context (occasion) is weighted lowest since it's usually unset.
export const OUTFIT_COMPATIBILITY_WEIGHTS = {
  color: 0.35,
  style: 0.25,
  weather: 0.25,
  context: 0.15,
} as const;
