// Centralized behavior-tracking event model (Explore milestone).
//
// This is deliberately broader than the existing PreferenceSignal type
// in /types/style.ts, which stays exactly as-is (still used by
// /look for AI-look personalization — see lib/style/preferences.tsx).
// PreferenceEvent is the superset event log Explore's recommendation
// engine learns from; the two are bridged in lib/events/store.ts so a
// like/dislike/save in Explore also becomes a PreferenceSignal, and the
// existing AI look generator keeps benefiting from Explore activity
// without any change to lib/look or the /look page's own recording.

export type PreferenceEventType =
  | "impression"
  | "view"
  | "like"
  | "dislike"
  | "save"
  | "unsave"
  | "open_product"
  | "open_look"
  | "change_item"
  | "skip"
  | "search"
  | "generate_look";

export interface PreferenceEvent {
  id: string;
  type: PreferenceEventType;
  timestamp: string;
  productId?: string | null;
  lookId?: string | null;
  category?: string | null;
  brand?: string | null;
  price?: number | null;
  /** Where the event happened, e.g. "explore", "look", "search". */
  source?: string | null;
  metadata?: Record<string, string | number | boolean | null> | null;
}

// Derived, inferred-from-behavior preferences. Distinct from the
// user's ExplicitProfile (UserStyleProfile in /types/style.ts) — never
// written back into it. All maps are keyed by a lowercase label
// (brand name, category bucket, color, fit) with a 0–1 strength, where
// 0.5 is neutral (see lib/events/behavioral.ts for how these are
// computed from the PreferenceEvent log).
export interface BehavioralPreferences {
  styles: Record<string, number>;
  colors: Record<string, number>;
  brands: Record<string, number>;
  categories: Record<string, number>;
  fits: Record<string, number>;
  priceRange?: {
    min?: number;
    max?: number;
  };
  /** How many events fed this derivation — lets a consumer decide
   *  whether the signal is strong enough to trust yet. */
  sampleSize: number;
}

export function createEmptyBehavioralPreferences(): BehavioralPreferences {
  return { styles: {}, colors: {}, brands: {}, categories: {}, fits: {}, sampleSize: 0 };
}
