import type { Product } from "@/types/product";

// LookAdviser domain types.
//
// This is the data model for the personalization layer that sits on
// top of the existing product-search engine (see /types/product.ts).
// Nothing here talks to eBay directly — see /lib/look for how a
// StyleProfile + WeatherData eventually turn into a ProductSearchProvider
// query.

export type StyleArchetypeId =
  | "minimalist"
  | "street"
  | "smart_casual"
  | "classic"
  | "vintage"
  | "functional"
  | "sporty"
  | "experimental";

export const STYLE_ARCHETYPES: StyleArchetypeId[] = [
  "minimalist",
  "street",
  "smart_casual",
  "classic",
  "vintage",
  "functional",
  "sporty",
  "experimental",
];

export type BudgetRangeId =
  | "under_100"
  | "100_200"
  | "200_400"
  | "400_700"
  | "700_plus"
  | "no_preference";

export const BUDGET_RANGES: BudgetRangeId[] = [
  "under_100",
  "100_200",
  "200_400",
  "400_700",
  "700_plus",
  "no_preference",
];

// Numeric bounds behind each BudgetRangeId, in EUR. Used later by the
// look generator to filter product search results — not by the
// onboarding UI itself, which only deals in the id.
export const BUDGET_RANGE_BOUNDS: Record<
  BudgetRangeId,
  { min: number; max: number | null }
> = {
  under_100: { min: 0, max: 100 },
  "100_200": { min: 100, max: 200 },
  "200_400": { min: 200, max: 400 },
  "400_700": { min: 400, max: 700 },
  "700_plus": { min: 700, max: null },
  no_preference: { min: 0, max: null },
};

export interface UserLocation {
  city: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  timezone: string | null;
  /** How the location was obtained — lets the UI distinguish a precise
   *  geolocation fix from a manually typed city. */
  source: "geolocation" | "manual";
}

// Persistent, slow-changing preferences. Weather is deliberately absent —
// it's contextual data fetched per-request, never stored on the profile
// (see /lib/weather).
export interface UserStyleProfile {
  styleArchetypes: StyleArchetypeId[];
  preferredFit: string | null;
  preferredColors: string[];
  dislikedColors: string[];
  preferredBrands: string[];
  dislikedBrands: string[];
  budgetRange: BudgetRangeId | null;
  location: UserLocation | null;
  favoriteCategories: string[];
  dislikedCategories: string[];
  /** The last look-gender the user picked on /look, remembered only for
   *  authenticated users (server-persisted, via the pre-existing
   *  genderPreference DB column) — guests always see /look default back
   *  to its hardcoded starting value instead of persisting anything
   *  locally. See /look/page.tsx's handleGenderChange for that split. */
  gender: LookGender | null;
  /** 0–1, how much of the profile is filled in. Recomputed on every save. */
  profileCompleteness: number;
  createdAt: string;
  updatedAt: string;
}

export function createEmptyStyleProfile(): UserStyleProfile {
  const now = new Date().toISOString();
  return {
    styleArchetypes: [],
    preferredFit: null,
    preferredColors: [],
    dislikedColors: [],
    preferredBrands: [],
    dislikedBrands: [],
    budgetRange: null,
    location: null,
    favoriteCategories: [],
    dislikedCategories: [],
    gender: null,
    profileCompleteness: 0,
    createdAt: now,
    updatedAt: now,
  };
}

// Only the fields this milestone's onboarding actually collects count
// towards completeness; the rest (fit, colors, brands, categories) are
// reserved for a future richer onboarding/learning loop.
export function computeProfileCompleteness(
  profile: Pick<UserStyleProfile, "styleArchetypes" | "budgetRange" | "location">,
): number {
  const fields = [
    profile.styleArchetypes.length > 0,
    profile.budgetRange !== null,
    profile.location !== null,
  ];
  return fields.filter(Boolean).length / fields.length;
}

// ---------------------------------------------------------------------
// Weather — contextual, never persisted on UserStyleProfile.
// ---------------------------------------------------------------------

export interface WeatherData {
  temperature: number;
  feelsLike: number;
  precipitationProbability: number | null;
  condition: "clear" | "clouds" | "rain" | "snow" | "storm" | "fog" | "unknown";
  windSpeed: number | null;
  observedAt: string;
  precipitation: number | null;
  rain: number | null;
  snowfall: number | null;
  weatherCode: number | null;
  sunrise: string | null;
  sunset: string | null;
  timezone: string | null;
}

// ---------------------------------------------------------------------
// The future full LookAdviser flow (see lib/look). Only the shapes are
// defined here; the generator that fills them in is a later milestone.
//
// This is deliberately split in two:
//  - CurrentLookContext: today's request — occasion/activity/mood/
//    free text, plus optional location and budget *overrides* for
//    this one request. Never persisted.
//  - LookContext: CurrentLookContext + the persistent UserStyleProfile,
//    the actual input a LookGenerator consumes.
// ---------------------------------------------------------------------

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export type LookActivity = string;
export type LookMood = string;
export type LookOccasion = string;

// Legacy option lists kept for API/backward compatibility. The /look UI now uses
// LOOK_INTENT_OPTIONS so the user chooses one combined activity/occasion intent.
export const OCCASION_OPTIONS = [
  "everyday",
  "work",
  "dinner",
  "date",
  "travel",
  "party",
  "event",
  "sport",
  "something_else",
] as const;

export const ACTIVITY_OPTIONS = [
  "walking",
  "office",
  "meeting_friends",
  "travel",
  "shopping",
  "outdoor",
  "sport",
  "dining",
] as const;

export const LOOK_INTENT_OPTIONS = [
  "everyday",
  "work_office",
  "walking",
  "meeting_friends",
  "dinner_restaurant",
  "date",
  "party",
  "event",
  "travel",
  "shopping",
  "outdoors",
  "sport",
  "something_else",
] as const;

export const MOOD_OPTIONS = [
  "relaxed",
  "smart",
  "minimal",
  "bold",
  "sporty",
  "casual",
  "dont_care",
] as const;

// A location for a single look request. Distinct from UserLocation
// (the profile's saved location) — every field is optional since the
// user may only give a city, only coordinates, or nothing at all and
// fall back to their profile's saved location.
export interface LookContextLocation {
  city: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  timezone: string | null;
}

// A one-off budget override for this look, distinct from the
// profile's BudgetRangeId band — lets a future UI ask "under €150 for
// this one" without changing the user's saved typical budget.
export interface LookContextBudget {
  min: number | null;
  max: number | null;
  currency: string | null;
}

export interface CurrentLookContext {
  intent: string | null;
  occasion: LookOccasion | null;
  activity: LookActivity | null;
  mood: LookMood | null;
  freeText: string | null;
  location: LookContextLocation | null;
  weather: WeatherData | null;
  budget: LookContextBudget | null;
  /** A one-off budget band for this look only, picked on /look itself —
   *  distinct from the profile's own budgetRange (which stays the
   *  user's saved typical budget and is never overwritten by this). */
  budgetRange: BudgetRangeId | null;
  temporal: LookTemporalContext | null;
}

export interface LookTemporalContext {
  localDate: string;
  localTime: string;
  timezone: string;
  dayOfWeek: string;
  isWeekend: boolean;
  season: "spring" | "summer" | "autumn" | "winter";
  timeOfDay: "morning" | "afternoon" | "evening" | "night";
}

export function createEmptyLookContext(): CurrentLookContext {
  return {
    intent: null,
    occasion: null,
    activity: null,
    mood: null,
    freeText: null,
    location: null,
    weather: null,
    budget: null,
    budgetRange: null,
    temporal: null,
  };
}

export type LookGender = "men" | "women" | "unisex";

export interface LookContext {
  profile: UserStyleProfile;
  locale: "en" | "ru" | "fr";
  gender: LookGender;
  current: CurrentLookContext;
  preferenceSignals: PreferenceSignal[];
}

export interface OutfitComponent {
  role: string; // e.g. "top", "outerwear", "bottom", "footwear"
  searchQuery: string;
  productId: string | null;
  product: Product | null;
  alternatives: Product[];
}

export interface GeneratedLook {
  id?: string;
  description?: string;
  createdAt?: string;
  title: string;
  components: OutfitComponent[];
  totalPrice: number | null;
  currency: string | null;
  styleNotes?: string[];
}

// Implemented by a future style engine: LookContext in, a shoppable
// outfit out. Kept as an interface now so routes/components can be
// wired against it before the real implementation lands.
export interface LookGenerator {
  generateLook(context: LookContext): Promise<GeneratedLook>;
}

// ---------------------------------------------------------------------
// Implicit preference signals — the future behavioral-learning input.
// Not persisted or acted on yet; recording is a no-op (see lib/look).
// ---------------------------------------------------------------------

export type PreferenceSignalType =
  | "like"
  | "dislike"
  | "save"
  | "open"
  | "click"
  | "add_to_collection"
  | "purchase";

export interface PreferenceSignal {
  type: PreferenceSignalType;
  productId: string;
  brand: string | null;
  category: string | null;
  occurredAt: string;
}
