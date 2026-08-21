import "server-only";
import type { RecommendationCandidate, RecommendationContext, RecommendationScore } from "@/types/explore";
import { BUDGET_RANGE_BOUNDS } from "@/types/style";

export interface FeatureExtractor {
  extract(candidates: RecommendationCandidate[], context: RecommendationContext): RecommendationCandidate[];
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function styleMatch(candidate: RecommendationCandidate, context: RecommendationContext): number {
  const styles = context.profile?.styleArchetypes ?? [];
  if (styles.length === 0) return 0.5; // no stated style — neutral, not a penalty
  const haystack = `${candidate.product.title} ${candidate.product.category ?? ""}`.toLowerCase();
  const hit = styles.some((style) => haystack.includes(style.replace("_", " ")));
  return hit ? 0.85 : 0.45;
}

// Occasion/activity scoring (section 3). Keyed by the existing
// LOOK_INTENT_OPTIONS vocabulary (types/style.ts) rather than a new
// enum. Each rule is a pair of keyword patterns: "boost" items score
// well for the occasion, "penalize" items are a poor fit for it.
// Anything that matches neither is a mild, not-quite-neutral default —
// most items are occasion-agnostic enough to work.
const INTENT_RULES: Record<string, { boost: RegExp; penalize: RegExp }> = {
  work_office: {
    boost: /(shirt|blazer|trouser|oxford|loafer|chino|blouse|suit|button.?down)/i,
    penalize: /(swim|beach|activewear|tank|flip.?flop|sequin)/i,
  },
  meeting_friends: {
    boost: /(casual|jean|sneaker|sweater|shirt)/i,
    penalize: /(swim|activewear)/i,
  },
  dinner_restaurant: {
    boost: /(dress|blazer|heel|elegant|silk|button.?down)/i,
    penalize: /(sport|athletic|sweat|flip.?flop)/i,
  },
  date: {
    boost: /(dress|elegant|heel|blazer|silk)/i,
    penalize: /(sweat|athletic|activewear)/i,
  },
  walking: {
    boost: /(sneaker|comfort|casual|jean|t-?shirt)/i,
    penalize: /(heel|formal|suit)/i,
  },
  outdoors: {
    boost: /(hiking|boot|jacket|fleece|technical|utility)/i,
    penalize: /(heel|dress|silk)/i,
  },
  sport: {
    boost: /(athletic|sport|training|running|activewear|legging)/i,
    penalize: /(dress|heel|blazer|silk|suit)/i,
  },
  party: {
    boost: /(statement|sequin|elegant|bold|evening|heel)/i,
    penalize: /(basic|plain|sweat)/i,
  },
  event: {
    boost: /(elegant|blazer|dress|tailored)/i,
    penalize: /(sweat|activewear)/i,
  },
  travel: {
    boost: /(comfort|versatile|packable|sneaker|jean)/i,
    penalize: /(heel|delicate|silk)/i,
  },
  shopping: {
    boost: /(casual|comfort|sneaker)/i,
    penalize: /(formal|suit)/i,
  },
  everyday: {
    boost: /()/, // matches nothing — everyday has no strong boost, just avoids penalties
    penalize: /()/,
  },
};

export function contextMatch(candidate: RecommendationCandidate, context: RecommendationContext): number {
  const intent = context.intent;
  // Section 3: "If the user has not specified an occasion/activity: use
  // neutral context scoring, do not penalize normal fashion items."
  if (!intent) return 0.5;
  const rule = INTENT_RULES[intent];
  if (!rule) return 0.5;

  const haystack = `${candidate.product.title} ${candidate.product.category ?? ""}`.toLowerCase();
  let score = 0.55; // known intent, no strong signal either way — mildly positive over pure neutral
  if (rule.penalize.test(haystack) && rule.penalize.source !== "()") score = 0.2;
  else if (rule.boost.test(haystack) && rule.boost.source !== "()") score = 0.9;

  // A light temporal nudge — time of day/season complementing the
  // occasion, never overriding the boost/penalize verdict above.
  if (context.temporal) {
    if (intent === "party" && context.temporal.timeOfDay === "evening") score += 0.05;
    if (intent === "sport" && (context.temporal.timeOfDay === "morning" || context.temporal.timeOfDay === "afternoon")) {
      score += 0.03;
    }
    if (intent === "outdoors" && context.temporal.season === "winter") score += 0.03;
  }

  return clamp01(score);
}

function preferenceMatch(candidate: RecommendationCandidate, context: RecommendationContext): number {
  const brandKey = candidate.product.brand?.toLowerCase();
  const categoryKey = candidate.bucket;
  const brandScore = brandKey ? context.behavioral.brands[brandKey] : undefined;
  const categoryScore = context.behavioral.categories[categoryKey];
  const scores = [brandScore, categoryScore].filter((v): v is number => v != null);
  if (scores.length === 0) return 0.5;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

function budgetMatch(candidate: RecommendationCandidate, context: RecommendationContext): number {
  const bounds = context.budgetRange ? BUDGET_RANGE_BOUNDS[context.budgetRange] : null;
  const price = candidate.product.price;
  if (!bounds) return 0.5;
  if (price < bounds.min * 0.5) return 0.6; // notably cheaper than stated budget — fine, not ideal
  if (bounds.max != null && price > bounds.max * 1.25) return 0.15; // well over budget
  if (bounds.max != null && price > bounds.max) return 0.5;
  return 1;
}

// Weather scoring (section 4). Deliberately keyword/threshold based —
// cheap, deterministic, no per-candidate API calls — but covers the
// spec's explicit cases: cold favors warm layers, hot favors
// lightweight pieces, rain favors waterproof items, and a genuinely
// extreme mismatch (heavy coat in hot weather) is scored low rather
// than just "not boosted".
export function weatherMatch(candidate: RecommendationCandidate, context: RecommendationContext): number {
  const weather = context.weather;
  // Section 4/13: missing weather must be neutral, not zero/negative.
  if (!weather) return 0.5;

  const title = `${candidate.product.title} ${candidate.product.category ?? ""}`.toLowerCase();
  const temp = weather.temperature;
  const cold = temp <= 10;
  const hot = temp >= 24;
  const rainy =
    weather.condition === "rain" ||
    weather.condition === "storm" ||
    (weather.precipitationProbability ?? 0) >= 50;

  const isWarmLayer = /(jacket|coat|sweater|boot|parka|thermal|fleece|wool|puffer)/.test(title);
  const isLightweight = /(short|tank|sandal|linen|dress|t-?shirt|sundress|flip.?flop)/.test(title);
  const isWaterproof = /(waterproof|rain|shell|gore.?tex)/.test(title);
  const isHeavyCoat = /(heavy coat|parka|puffer|winter coat|wool coat|down jacket)/.test(title);

  let score = 0.5;

  if (rainy) {
    if (isWaterproof) score = Math.max(score, 0.95);
    else if (candidate.bucket === "footwear" && /boot/.test(title)) score = Math.max(score, 0.75);
  }
  if (cold && isWarmLayer) score = Math.max(score, 0.9);
  if (hot && isLightweight) score = Math.max(score, 0.9);

  // Extreme mismatches (section 4) — scored low, not just "unboosted".
  if (hot && isHeavyCoat) score = 0.1;
  if (cold && isLightweight && candidate.bucket !== "footwear") score = Math.min(score, 0.25);

  if (weather.windSpeed != null && weather.windSpeed >= 30 && candidate.bucket === "outerwear") {
    score = Math.max(score, 0.7);
  }

  return clamp01(score);
}

function quality(candidate: RecommendationCandidate): number {
  const feedback = candidate.product.seller?.feedbackPercentage;
  if (feedback == null) return 0.6;
  return clamp01(feedback / 100);
}

function freshness(candidate: RecommendationCandidate, context: RecommendationContext): number {
  return context.excludeIds.includes(candidate.product.id) ? 0 : 1;
}

function explorationBonus(candidate: RecommendationCandidate): number {
  return candidate.classification === "exploration" ? 0.25 : candidate.classification === "adjacent" ? 0.1 : 0;
}

function dislikePenalty(candidate: RecommendationCandidate, context: RecommendationContext): number {
  const brandKey = candidate.product.brand?.toLowerCase();
  const explicitDislikedBrand = context.profile?.dislikedBrands
    .map((b) => b.toLowerCase())
    .includes(brandKey ?? "__none__");
  const behavioralDislike = brandKey && context.behavioral.brands[brandKey] != null
    ? Math.max(0, 0.5 - context.behavioral.brands[brandKey]) * 2
    : 0;
  const categoryDislike = Math.max(0, 0.5 - (context.behavioral.categories[candidate.bucket] ?? 0.5)) * 2;
  return clamp01((explicitDislikedBrand ? 0.6 : 0) + behavioralDislike * 0.4 + categoryDislike * 0.2);
}

class DefaultFeatureExtractor implements FeatureExtractor {
  extract(candidates: RecommendationCandidate[], context: RecommendationContext): RecommendationCandidate[] {
    return candidates.map((candidate) => {
      const score: RecommendationScore = {
        styleMatch: styleMatch(candidate, context),
        contextMatch: contextMatch(candidate, context),
        preferenceMatch: preferenceMatch(candidate, context),
        budgetMatch: budgetMatch(candidate, context),
        weatherMatch: weatherMatch(candidate, context),
        quality: quality(candidate),
        freshness: freshness(candidate, context),
        explorationBonus: explorationBonus(candidate),
        repetitionPenalty: 0, // filled in by the Diversifier, which sees ordering
        dislikePenalty: dislikePenalty(candidate, context),
        totalScore: 0, // filled in by the Ranker
      };
      return { ...candidate, score };
    });
  }
}

export const featureExtractor: FeatureExtractor = new DefaultFeatureExtractor();
