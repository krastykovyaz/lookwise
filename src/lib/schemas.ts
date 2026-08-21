import { z } from "zod";

// What we require DeepSeek's output to look like before it's ever
// passed to the eBay client. Anything that fails this is treated as
// "DeepSeek gave us an invalid structured result" — never trusted as-is.
export const EbaySearchCriteriaSchema = z.object({
  query: z.string().trim().min(1).max(120),
  category: z.string().trim().max(80).nullish(),
  brand: z.string().trim().max(80).nullish(),
  condition: z.array(z.string().trim().max(40)).max(5).optional().default([]),
  color: z.string().trim().max(40).nullish(),
  maxPrice: z.number().positive().max(1_000_000).nullish(),
  minPrice: z.number().nonnegative().max(1_000_000).nullish(),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/)
    .nullish(),
  deliveryCountry: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/)
    .nullish(),
  size: z.string().trim().max(20).nullish(),
  keywords: z.array(z.string().trim().max(40)).max(8).optional().default([]),
});
export type ValidatedEbaySearchCriteria = z.infer<
  typeof EbaySearchCriteriaSchema
>;

// What the client sends to POST /api/buyer/search. A fresh search sends
// `prompt` (goes through DeepSeek). Paging in more results for an
// existing search sends back the already-parsed `criteria` plus the
// next `offset` instead, so "load more" never re-runs DeepSeek and
// never risks it reinterpreting the same prompt differently the
// second time around.
export const SearchRequestSchema = z
  .object({
    prompt: z.string().trim().min(1).max(500).optional(),
    locale: z.enum(["en", "ru", "fr"]).optional().default("en"),
    criteria: EbaySearchCriteriaSchema.optional(),
    offset: z.number().int().nonnegative().max(10_000).optional().default(0),
  })
  .refine((data) => Boolean(data.prompt) || Boolean(data.criteria), {
    message: "Request must include either 'prompt' or 'criteria'.",
  });
export type SearchRequestInput = z.infer<typeof SearchRequestSchema>;

// What the client sends to POST /api/geocode/reverse.


export const CityGeocodeRequestSchema = z.object({
  city: z.string().trim().min(1).max(120),
});
export type CityGeocodeRequestInput = z.infer<typeof CityGeocodeRequestSchema>;

export const ReverseGeocodeRequestSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});
export type ReverseGeocodeRequestInput = z.infer<typeof ReverseGeocodeRequestSchema>;

// What the client sends to POST /api/look/generate.
// The app has no auth/database yet (see /lib/style/store), so the
// caller's UserStyleProfile — read from localStorage client-side —
// travels with the request rather than being looked up server-side.
export const LookGenerateRequestSchema = z.object({
  locale: z.enum(["en", "ru", "fr"]).default("en"),
  gender: z.enum(["men", "women"]),
  profile: z.object({
    styleArchetypes: z.array(z.string()).default([]),
    preferredFit: z.string().nullish(),
    preferredColors: z.array(z.string()).default([]),
    dislikedColors: z.array(z.string()).default([]),
    preferredBrands: z.array(z.string()).default([]),
    dislikedBrands: z.array(z.string()).default([]),
    budgetRange: z.string().nullish(),
    location: z
      .object({
        city: z.string().nullish(),
        country: z.string().nullish(),
        latitude: z.number().nullish(),
        longitude: z.number().nullish(),
        timezone: z.string().nullish(),
        source: z.enum(["geolocation", "manual"]),
      })
      .nullish(),
    favoriteCategories: z.array(z.string()).default([]),
    dislikedCategories: z.array(z.string()).default([]),
    profileCompleteness: z.number().default(0),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
  current: z.object({
    intent: z.string().trim().max(60).nullish(),
    occasion: z.string().trim().max(60).nullish(),
    activity: z.string().trim().max(60).nullish(),
    mood: z.string().trim().max(60).nullish(),
    freeText: z.string().trim().max(300).nullish(),
    location: z
      .object({
        city: z.string().nullish(),
        country: z.string().nullish(),
        latitude: z.number().nullish(),
        longitude: z.number().nullish(),
        timezone: z.string().nullish(),
      })
      .nullish(),
    budget: z
      .object({
        min: z.number().nullish(),
        max: z.number().nullish(),
        currency: z.string().nullish(),
      })
      .nullish(),
    temporal: z
      .object({
        localDate: z.string(),
        localTime: z.string(),
        timezone: z.string(),
        dayOfWeek: z.string(),
        isWeekend: z.boolean(),
        season: z.enum(["spring", "summer", "autumn", "winter"]),
        timeOfDay: z.enum(["morning", "afternoon", "evening", "night"]),
      })
      .nullish(),
  }),
  preferenceSignals: z.array(
    z.object({
      type: z.enum(["like", "dislike", "save", "open", "click", "add_to_collection", "purchase"]),
      productId: z.string().min(1).max(200),
      brand: z.string().nullable(),
      category: z.string().nullable(),
      occurredAt: z.string(),
    }),
  ).max(100).default([]),
});
export type LookGenerateRequestInput = z.infer<typeof LookGenerateRequestSchema>;


// What the client sends to GET /api/explore. Kept flat and bounded so it
// travels safely as a query string — there's no auth/database, so (like
// /api/look/generate) the caller's locally-derived context comes along
// with the request rather than being looked up server-side. Comma-joined
// lists are used instead of repeated params for simplicity; each is
// capped well below anything that would bloat a URL.
const commaList = (max: number) =>
  z
    .string()
    .max(400)
    .optional()
    .transform((value) =>
      value
        ? value
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean)
            .slice(0, max)
        : [],
    );

export const ExploreQuerySchema = z.object({
  sessionId: z.string().trim().min(1).max(120).nullish(),
  cursor: z.string().max(4000).nullish(),
  styles: commaList(8),
  budget: z.string().max(40).nullish(),
  prefBrands: commaList(10),
  dislBrands: commaList(10),
  prefColors: commaList(10),
  dislColors: commaList(10),
  topBrands: commaList(6),
  bottomBrands: commaList(6),
  topCategories: commaList(6),
  bottomCategories: commaList(6),
  lat: z.coerce.number().min(-90).max(90).nullish(),
  lon: z.coerce.number().min(-180).max(180).nullish(),
  tz: z.string().max(60).nullish(),
  // Optional occasion/activity + mood, reusing the existing
  // LOOK_INTENT_OPTIONS/MOOD_OPTIONS vocabulary from types/style.ts
  // (validated against that list server-side in the route, not here,
  // to avoid a schema/types import cycle) — Explore has no UI for these
  // yet, so they're typically absent, which contextMatch treats as
  // neutral rather than inventing an occasion.
  intent: z.string().max(40).nullish(),
  mood: z.string().max(40).nullish(),
  debug: z.string().nullish(),
});
export type ExploreQueryInput = z.infer<typeof ExploreQuerySchema>;

export const LookPlanSchema = z.object({
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(500),
  components: z.array(
    z.object({
      role: z.string().trim().min(1).max(40),
      searchQuery: z.string().trim().min(2).max(120),
      color: z.string().trim().max(40).nullish(),
      maxPrice: z.number().positive().max(1_000_000).nullish(),
    }),
  ).min(2).max(5),
  styleNotes: z.array(z.string().trim().min(1).max(100)).max(5).default([]),
});
export type LookPlan = z.infer<typeof LookPlanSchema>;

// ---------------------------------------------------------------------
// Product / look SNAPSHOT payloads — what the client sends when
// recording a view or a save, so the server can cache enough to
// reconstruct the item later (see lib/db/repositories/reconstruct.ts).
// This mirrors types/product.ts's Product and types/style.ts's
// GeneratedLook, not a new shape of its own. Kept permissive
// (`.nullish()`/`.optional()` rather than rejecting) since a snapshot
// that's missing a cosmetic field (color, a shipping estimate) is far
// better than losing the save/view entirely over a strict schema
// mismatch — the DB columns backing these are nullable for exactly
// this reason (see schema/domain.ts's `product` table).
// ---------------------------------------------------------------------

export const ProductSnapshotSchema = z.object({
  id: z.string().trim().min(1).max(300),
  title: z.string().trim().min(1).max(500),
  price: z.number().nonnegative().nullish(),
  currency: z.string().trim().max(10).nullish(),
  image: z.string().trim().max(2000).nullish(),
  condition: z.string().trim().max(120).nullish(),
  brand: z.string().trim().max(200).nullish(),
  category: z.string().trim().max(200).nullish(),
  seller: z
    .object({
      username: z.string().trim().max(200).nullish(),
      feedbackScore: z.number().nullish(),
      feedbackPercentage: z.number().nullish(),
    })
    .nullish(),
  availability: z.string().trim().max(120).nullish(),
  itemWebUrl: z.string().trim().max(2000).nullish(),
});
export type ProductSnapshotInput = z.infer<typeof ProductSnapshotSchema>;

export const LookSnapshotSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).nullish(),
  components: z
    .array(
      z.object({
        role: z.string().trim().min(1).max(40),
        product: ProductSnapshotSchema.nullish(),
      }),
    )
    .max(12),
});
export type LookSnapshotRequestInput = z.infer<typeof LookSnapshotSchema>;
