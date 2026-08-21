// Derives BehavioralPreferences from a PreferenceEvent log. Pure and
// framework-free so it can run client-side (from localStorage events,
// before calling /api/explore) or, later, server-side unchanged.
//
// Not scientifically tuned (section 7 says not to pretend otherwise) —
// sensible initial weights plus a simple exponential time-decay so
// recent actions count for more than old ones.

import type { PreferenceEvent, PreferenceEventType, BehavioralPreferences } from "@/types/events";
import { createEmptyBehavioralPreferences } from "@/types/events";

export const SIGNAL_WEIGHTS: Record<PreferenceEventType, number> = {
  like: 1.0,
  save: 1.0,
  dislike: -1.0,
  unsave: -0.3,
  open_product: 0.35,
  open_look: 0.3,
  view: 0.05,
  impression: 0,
  change_item: -0.4, // swapping an item out is a mild negative for that specific item
  skip: -0.15,
  search: 0,
  generate_look: 0.2,
};

// Half-life in days: a signal from 14 days ago counts for half as much
// as one from today. Deliberately simple (section 7: "do not
// over-engineer this").
const HALF_LIFE_DAYS = 14;

function decayFactor(occurredAt: string, now: number): number {
  const ageDays = Math.max(0, (now - new Date(occurredAt).getTime()) / 86_400_000);
  return Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
}

function bump(map: Record<string, number>, key: string | null | undefined, delta: number) {
  if (!key) return;
  const normalizedKey = key.trim().toLowerCase();
  if (!normalizedKey) return;
  map[normalizedKey] = (map[normalizedKey] ?? 0) + delta;
}

// Maps a raw signed accumulator to 0–1, with 0.5 as neutral, the way
// UserPreferenceModel (section 6) specifies ("normalized between 0 and 1").
function squash(raw: number, maxAbs: number): number {
  if (maxAbs <= 0) return 0.5;
  return Math.min(1, Math.max(0, 0.5 + (raw / maxAbs) * 0.5));
}

export function deriveBehavioralPreferences(
  events: PreferenceEvent[],
  now: number = Date.now(),
): BehavioralPreferences {
  const result = createEmptyBehavioralPreferences();
  if (events.length === 0) return result;

  const rawBrands: Record<string, number> = {};
  const rawCategories: Record<string, number> = {};
  let prices: number[] = [];

  for (const event of events) {
    const weight = SIGNAL_WEIGHTS[event.type] ?? 0;
    if (weight === 0) continue;
    const delta = weight * decayFactor(event.timestamp, now);
    bump(rawBrands, event.brand, delta);
    bump(rawCategories, event.category, delta);
    if (delta > 0 && event.price != null) prices.push(event.price);
  }

  const maxAbs = (map: Record<string, number>) =>
    Object.values(map).reduce((max, value) => Math.max(max, Math.abs(value)), 0);

  const brandMax = maxAbs(rawBrands);
  const categoryMax = maxAbs(rawCategories);
  for (const [key, value] of Object.entries(rawBrands)) result.brands[key] = squash(value, brandMax);
  for (const [key, value] of Object.entries(rawCategories)) result.categories[key] = squash(value, categoryMax);

  if (prices.length > 0) {
    prices = prices.sort((a, b) => a - b);
    // A soft budget window from the liked/saved/opened price distribution —
    // 10th to 90th percentile, so a single outlier doesn't skew it.
    const p = (q: number) => prices[Math.min(prices.length - 1, Math.floor(q * prices.length))];
    result.priceRange = { min: Math.round(p(0.1)), max: Math.round(p(0.9)) };
  }

  result.sampleSize = events.length;
  return result;
}

// Top-N labels by strength, for compact transport (e.g. in the
// /api/explore query string — see lib/explore/session.tsx).
export function topLabels(map: Record<string, number>, n: number, aboveNeutral = true): string[] {
  return Object.entries(map)
    .filter(([, value]) => !aboveNeutral || value > 0.5)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key]) => key);
}

export function bottomLabels(map: Record<string, number>, n: number): string[] {
  return Object.entries(map)
    .filter(([, value]) => value < 0.5)
    .sort((a, b) => a[1] - b[1])
    .slice(0, n)
    .map(([key]) => key);
}
