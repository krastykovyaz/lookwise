// Explore / RecommendationEngine domain types.
//
// Mirrors the architecture requested for the Explore milestone:
//   CandidateGenerator -> FeatureExtractor -> Ranker -> Diversifier -> Feed
//
// Nothing here is ML — every implementation (see /lib/recommendation)
// is rule-based, but the interfaces are shaped so a future implementation
// (embeddings, a learned ranker, collaborative filtering) can be dropped
// in without touching the Explore UI or the /api/explore route.

import type { Product } from "@/types/product";
import type {
  BudgetRangeId,
  GeneratedLook,
  LookTemporalContext,
  UserStyleProfile,
  WeatherData,
} from "@/types/style";
import type { BehavioralPreferences } from "@/types/events";

// A cheap, non-PII bucket a raw product is grouped into so looks can be
// assembled from complementary pieces (see lib/recommendation/categorize.ts).
export type ProductRoleBucket =
  | "top"
  | "bottom"
  | "outerwear"
  | "footwear"
  | "accessory"
  | "other";

export type RecommendationClassification = "familiar" | "adjacent" | "exploration";

// Everything the pipeline needs to score and diversify a feed. Built once
// per /api/explore request from the (mostly client-supplied) profile,
// derived behavioral preferences, and session state — see the route
// handler for how this is assembled. Reuses existing types wherever
// possible instead of duplicating profile/context models.
export interface RecommendationContext {
  profile: Pick<
    UserStyleProfile,
    "styleArchetypes" | "budgetRange" | "preferredBrands" | "dislikedBrands" | "preferredColors" | "dislikedColors"
  > | null;
  behavioral: BehavioralPreferences;
  location: { latitude: number | null; longitude: number | null; timezone: string | null };
  weather: WeatherData | null;
  temporal: LookTemporalContext | null;
  budgetRange: BudgetRangeId | null;
  /** One of LOOK_INTENT_OPTIONS (types/style.ts), or null if the user
   *  hasn't specified an occasion/activity for this Explore session —
   *  reused rather than inventing a parallel enum (section 3). Explore
   *  has no UI to set this yet, so it's null today; contextMatch treats
   *  null as neutral rather than inventing an occasion. */
  intent: string | null;
  /** One of MOOD_OPTIONS (types/style.ts), same "unset is fine" rule. */
  mood: string | null;
  /** Product ids already shown this session (and earlier ones, capped) —
   *  passed to candidate generation so it can request exclusion. */
  excludeIds: string[];
  /** Seller usernames already shown this session — at most one item
   *  per seller per session ("cards should be formed from unique
   *  sellers"). Same session-scoped exclusion mechanism as excludeIds,
   *  just keyed on product.seller.username instead of product id. */
  excludeSellers: string[];
  /** Session id for pool-generation bookkeeping only (see pool.ts
   *  nextPoolGeneration) — never used as a scoring/ranking input. */
  sessionId: string;
  /** How many times this session has generated a fresh candidate pool
   *  (see pool.ts nextPoolGeneration). Used only to page deeper into
   *  eBay's result set on regeneration — not a ranking/scoring input.
   *  Set by the engine at the moment a pool is actually created; the
   *  value on the context passed into getFeed is a placeholder. */
  poolGeneration: number;
  mix: RecommendationMix;
}

// ~70/20/10 familiar/adjacent/exploration split (section 10). Kept as
// data, not a hard-coded constant, so it can later be tuned server-side.
export interface RecommendationMix {
  familiar: number;
  adjacent: number;
  exploration: number;
}

export const DEFAULT_RECOMMENDATION_MIX: RecommendationMix = {
  familiar: 0.7,
  adjacent: 0.2,
  exploration: 0.1,
};

// A single candidate product moving through the pipeline, gaining more
// fields as it passes each stage.
export interface RecommendationCandidate {
  product: Product;
  bucket: ProductRoleBucket;
  /** Which CandidateSource query produced this — used for diversity and debug. */
  sourceQuery: string;
  classification: RecommendationClassification;
  score?: RecommendationScore;
}

// Transparent, explainable scoring (section 12). Every component is
// normalized to roughly 0–1 (penalties are positive numbers subtracted
// in the total). Never sent to production clients — see the /api/explore
// route, which strips this unless ?debug=1 and NODE_ENV !== "production".
export interface RecommendationScore {
  styleMatch: number;
  contextMatch: number;
  preferenceMatch: number;
  budgetMatch: number;
  weatherMatch: number;
  quality: number;
  freshness: number;
  explorationBonus: number;
  repetitionPenalty: number;
  dislikePenalty: number;
  totalScore: number;
}

// One feed card. Reuses the existing GeneratedLook shape (components with
// role/product/alternatives) so it renders through the exact same
// product-grid pattern as /look, instead of a parallel model — see
// components/explore/ExploreLookCard.tsx. A "spotlight" card (a single
// standout product that didn't get paired into a full outfit — common
// given eBay Sandbox's shoe-heavy inventory) is just a look with one
// component.
export interface ExploreFeedItem {
  look: GeneratedLook;
  classification: RecommendationClassification;
  /** Present only when the request asked for debug scoring. */
  debug?: { scores: RecommendationScore[] };
}

export interface RecommendationResult {
  items: ExploreFeedItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

// The assembled feed, partitioned by classification (section 1) so a
// page can be built by quota rather than by taking the top N globally
// — see mixSelector.ts. Order within each bucket is preserved from
// ranking/diversification.
export type BucketedPool = Record<RecommendationClassification, ExploreFeedItem[]>;

// How far into each bucket the session has already paged — carried in
// the opaque cursor (lib/recommendation/pool.ts) so a request can
// resume exactly where the previous one left off, per bucket.
export type BucketOffsets = Record<RecommendationClassification, number>;

// A client-side feed session (section 15) — tracked in
// lib/explore/session.tsx, not persisted beyond the page lifetime (the
// provider lives in the root layout so it survives navigation to a
// product and back, but a hard refresh starts a new session by design).
export interface FeedSession {
  sessionId: string;
  startedAt: string;
  shownIds: string[];
  cursor: string | null;
}
