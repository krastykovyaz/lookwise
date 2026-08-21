import "server-only";
import type { BucketedPool, BucketOffsets, ExploreFeedItem, RecommendationClassification, RecommendationMix } from "@/types/explore";

const CLASSIFICATIONS: RecommendationClassification[] = ["familiar", "adjacent", "exploration"];

export function emptyOffsets(): BucketOffsets {
  return { familiar: 0, adjacent: 0, exploration: 0 };
}

export function emptyPool(): BucketedPool {
  return { familiar: [], adjacent: [], exploration: [] };
}

// Splits ranked+assembled feed items into the three classification
// buckets, preserving their relative (ranked) order within each bucket.
export function partitionByClassification(items: ExploreFeedItem[]): BucketedPool {
  const pool = emptyPool();
  for (const item of items) pool[item.classification].push(item);
  return pool;
}

// Largest-remainder rounding so the per-bucket quota always sums to
// exactly pageSize, even when pageSize * ratio isn't a whole number
// (section 1: "Make the target mix configurable" — this works for any
// RecommendationMix, not just the 70/20/10 default).
export function computeQuota(pageSize: number, mix: RecommendationMix): BucketOffsets {
  const raw: BucketOffsets = {
    familiar: pageSize * mix.familiar,
    adjacent: pageSize * mix.adjacent,
    exploration: pageSize * mix.exploration,
  };
  const floors = emptyOffsets();
  for (const key of CLASSIFICATIONS) floors[key] = Math.floor(raw[key]);

  let remainder = pageSize - CLASSIFICATIONS.reduce((sum, key) => sum + floors[key], 0);
  const byFractionDesc = [...CLASSIFICATIONS].sort((a, b) => raw[b] - Math.floor(raw[b]) - (raw[a] - Math.floor(raw[a])));

  const quota = { ...floors };
  let i = 0;
  while (remainder > 0 && i < byFractionDesc.length * 4) {
    quota[byFractionDesc[i % byFractionDesc.length]] += 1;
    remainder--;
    i++;
  }
  return quota;
}

// If a bucket falls short of its quota, pull the shortfall from the
// next-best bucket instead (section 1: "gracefully fill from the next
// best available bucket"). Ordered by how close a substitute is to the
// original intent.
const FALLBACK_ORDER: Record<RecommendationClassification, RecommendationClassification[]> = {
  familiar: ["adjacent", "exploration"],
  adjacent: ["familiar", "exploration"],
  exploration: ["adjacent", "familiar"],
};

export interface MixSelectionResult {
  page: ExploreFeedItem[];
  offsets: BucketOffsets;
}

// Section 1: "Do NOT simply take the top 10 globally." This is the
// dedicated mix-enforcement step, applied after ranking/diversification/
// assembly (see engine.ts) and before the page-level diversifier pass.
export function selectMixedPage(
  pool: BucketedPool,
  offsets: BucketOffsets,
  mix: RecommendationMix,
  pageSize: number,
): MixSelectionResult {
  const quota = computeQuota(pageSize, mix);
  const nextOffsets: BucketOffsets = { ...offsets };
  const page: ExploreFeedItem[] = [];
  const shortfall = emptyOffsets();

  for (const bucket of CLASSIFICATIONS) {
    const available = Math.max(0, pool[bucket].length - nextOffsets[bucket]);
    const take = Math.min(quota[bucket], available);
    if (take > 0) {
      page.push(...pool[bucket].slice(nextOffsets[bucket], nextOffsets[bucket] + take));
      nextOffsets[bucket] += take;
    }
    shortfall[bucket] = quota[bucket] - take;
  }

  for (const bucket of CLASSIFICATIONS) {
    let short = shortfall[bucket];
    if (short <= 0) continue;
    for (const fallback of FALLBACK_ORDER[bucket]) {
      if (short <= 0) break;
      const available = Math.max(0, pool[fallback].length - nextOffsets[fallback]);
      const take = Math.min(short, available);
      if (take > 0) {
        page.push(...pool[fallback].slice(nextOffsets[fallback], nextOffsets[fallback] + take));
        nextOffsets[fallback] += take;
        short -= take;
      }
    }
  }

  // Final catch-all: something is available anywhere and the page is
  // still short (e.g. two buckets both ran dry) — never return an empty
  // or short feed just because one bucket is exhausted (section 1/8),
  // as long as *any* candidates remain.
  if (page.length < pageSize) {
    for (const bucket of CLASSIFICATIONS) {
      if (page.length >= pageSize) break;
      const available = pool[bucket].length - nextOffsets[bucket];
      if (available <= 0) continue;
      const take = Math.min(pageSize - page.length, available);
      page.push(...pool[bucket].slice(nextOffsets[bucket], nextOffsets[bucket] + take));
      nextOffsets[bucket] += take;
    }
  }

  return { page, offsets: nextOffsets };
}

export function isPoolExhausted(pool: BucketedPool, offsets: BucketOffsets): boolean {
  return CLASSIFICATIONS.every((bucket) => offsets[bucket] >= pool[bucket].length);
}
