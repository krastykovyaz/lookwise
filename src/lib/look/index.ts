import "server-only";
import type { Product } from "@/types/product";
import type {
  CurrentLookContext,
  GeneratedLook,
  LookContext,
  LookGender,
  LookGenerator,
  OutfitComponent,
  PreferenceSignal,
  UserStyleProfile,
} from "@/types/style";
import { BUDGET_RANGE_BOUNDS, createEmptyLookContext } from "@/types/style";
import { searchProducts as searchEbayProducts } from "@/lib/ebay";
import { generateJsonObject } from "@/lib/ai/deepseek";
import { LookPlanSchema } from "@/lib/schemas";
import { getProductGender, gendersCompatible, type ProductGender } from "@/lib/recommendation/gender";

export function buildLookContext(
  profile: UserStyleProfile,
  current: Partial<CurrentLookContext> = {},
  preferenceSignals: PreferenceSignal[] = [],
  locale: "en" | "ru" | "fr" = "en",
  gender: LookGender = "women",
): LookContext {
  return {
    profile,
    current: { ...createEmptyLookContext(), ...current },
    locale,
    gender,
    preferenceSignals,
  };
}

export interface OutfitComponentSearchIntent {
  query: string;
  maxPrice?: number | null;
  minPrice?: number | null;
  currency?: string | null;
  color?: string | null;
  deliveryCountry?: string | null;
}

export interface ProductSearchProvider {
  search(intent: OutfitComponentSearchIntent): Promise<Product[]>;
}

class EbayProductSearchProvider implements ProductSearchProvider {
  async search(intent: OutfitComponentSearchIntent): Promise<Product[]> {
    const result = await searchEbayProducts({
      query: intent.query,
      category: null,
      brand: null,
      condition: [],
      color: intent.color ?? null,
      maxPrice: intent.maxPrice ?? null,
      minPrice: intent.minPrice ?? null,
      currency: intent.currency ?? null,
      deliveryCountry: intent.deliveryCountry ?? null,
      size: null,
      keywords: [],
    });
    return result.items;
  }
}

export const productSearchProvider: ProductSearchProvider =
  new EbayProductSearchProvider();

export class LookGeneratorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LookGeneratorError";
  }
}

const LOOK_SYSTEM_PROMPT = `You are LookAdviser, a personal fashion stylist.
Create a practical, shoppable outfit plan from the user's persistent style profile and current context.
The outfit must feel like one intentional look, not a random collection of individually relevant products.

Rules:
- Return JSON only.
- Write the title, description, and every styleNotes entry in the same language as the user request/free-text. If free-text has no clear language, use the requested UI language.
- Requested UI language: {{LOCALE}}.
- Requested look gender: {{GENDER}} (men, women, or unisex).
- Never invent products, prices, sellers, or availability. You only create SEARCH INTENTS; real products will be fetched from eBay after you respond.
- Build a coherent outfit with 2 to 5 components. Typical roles: top, bottom, outerwear, footwear, accessory.
- Make all components compatible in dress level, silhouette, palette and season.
- Prefer a restrained palette (usually 2–4 compatible colors) unless the user's style explicitly calls for contrast.
- Avoid mixing conflicting aesthetics such as formal tailoring with athletic pieces unless the context explicitly asks for it.
- Every component's search query must target the same gender department consistently (all men's, all women's, or all unisex/gender-neutral) — never mix men's and women's items in the same look. If the user's profile or context doesn't specify, pick one gender department and use it for every component.
- Real products (with real sellers) are matched to your search queries after you respond — you cannot see or choose sellers, but be aware every component must end up from a distinct seller, so favor queries specific enough to plausibly match different listings.
- Search queries must be concrete marketplace queries, not vague fashion advice.
- Respect the user's style archetypes, fit, colors, brands and budget when provided.
- Use weather and time context to decide layers and materials.
- If weather is unavailable, do not claim a weather fact.
- Do not require an item that is inappropriate for the weather or occasion.
- Prefer versatile, purchasable pieces.
- Treat recent like/dislike signals as strong personalization hints: avoid disliked brands/categories when possible and favor patterns from liked items.
- Never force a previously liked item into the new look; use the signals to guide the overall selection.
- maxPrice is an approximate per-item ceiling in the user's budget currency; set null when there is no meaningful ceiling.
- Do not mention eBay in the title.
- JSON shape:
{
  "title": "short outfit name",
  "description": "short description of why this outfit works, in the requested language",
  "components": [
    {
      "role": "top",
      "searchQuery": "white relaxed heavyweight t-shirt",
      "color": "white",
      "maxPrice": 35
    }
  ],
  "styleNotes": ["Neutral palette", "Relaxed silhouette", "Weather-appropriate layering"]
}`;

function profileBudgetText(profile: UserStyleProfile): string {
  if (!profile.budgetRange) return "no stated budget";
  const bounds = BUDGET_RANGE_BOUNDS[profile.budgetRange];
  return bounds.max == null
    ? `from €${bounds.min} upward`
    : `€${bounds.min}–€${bounds.max} total`;
}

function contextForPrompt(context: LookContext): string {
  return JSON.stringify({
    requestedLanguage: context.locale,
    requestedGender: context.gender,
    profile: {
      styles: context.profile.styleArchetypes,
      budget: profileBudgetText(context.profile),
      fit: context.profile.preferredFit,
      preferredColors: context.profile.preferredColors,
      dislikedColors: context.profile.dislikedColors,
      preferredBrands: context.profile.preferredBrands,
      dislikedBrands: context.profile.dislikedBrands,
      location: context.profile.location,
    },
    current: {
      whatToDo: context.current.intent ?? context.current.activity ?? context.current.occasion ?? null,
      mood: context.current.mood,
      freeText: context.current.freeText,
      location: context.current.location,
      weather: context.current.weather,
      temporal: context.current.temporal,
      budget: context.current.budget,
    },
    recentPreferenceSignals: context.preferenceSignals.slice(-30),
  });
}

type ComponentSearchResult = {
  component: { role: string; searchQuery: string; color?: string | null; maxPrice?: number | null };
  products: Product[];
};

/** Turns the user's selected budget band (a *total* for the whole
 *  outfit — see profileBudgetText) into a real per-component price
 *  floor for eBay, split evenly across however many components the AI
 *  plan has. Previously nothing did this: the AI's own per-component
 *  maxPrice was the only price signal ever sent to eBay, so a "700+"
 *  selection could silently return an outfit costing a fraction of
 *  that. If the AI's proposed ceiling for a component is below the
 *  computed floor, the ceiling is dropped rather than sent — a
 *  price:[min..max] range with min > max would just return nothing for
 *  that component, and the floor reflects what the user actually
 *  chose. Exported for direct unit testing (see verify-look.ts). */
export function computeComponentSearchPriceBounds(
  componentMaxPrice: number | null,
  budgetRange: UserStyleProfile["budgetRange"],
  componentCount: number,
): { minPrice: number | null; maxPrice: number | null } {
  const bounds = budgetRange ? BUDGET_RANGE_BOUNDS[budgetRange] : null;
  const minPrice = bounds && bounds.min > 0 && componentCount > 0 ? bounds.min / componentCount : null;
  const maxPrice = componentMaxPrice != null && minPrice != null && componentMaxPrice < minPrice ? null : componentMaxPrice;
  return { minPrice, maxPrice };
}

// Men's and women's items must never end up in the same generated
// look (a hard rule, not a soft preference — see gendersCompatible in
// lib/recommendation/gender.ts, which Explore's own look assembly
// already relies on for the same reason). Unlike Explore, this
// pipeline searches each role independently via DeepSeek-authored
// queries with no cross-component awareness, so nothing previously
// prevented one role's search from returning a men's item and
// another's a women's item for the same look. This walks the
// components in order, establishes the look's gender from the first
// component with a determinable one, and for every component after
// that prefers the first already-fetched candidate that's compatible
// — falling back to leaving the role empty (product: null, which the
// UI already renders as a skipped slot) rather than ever including a
// known-incompatible item.
// Enforces two hard rules across a generated look's own components:
// (1) never mix men's and women's items (see the file-level comment on
// gendersCompatible in lib/recommendation/gender.ts), and (2) every
// component must be from a distinct seller — "cards should be formed
// from unique sellers". Both are cumulative constraints (gender AND
// seller), tracked together in one pass so a candidate only has to be
// checked once per component.
export function selectConsistentComponents(results: ComponentSearchResult[], requestedGender: LookGender = "men"): OutfitComponent[] {
  // "unisex" requested -> lookGender starts as "unisex", and
  // gendersCompatible already treats "unisex" as compatible with
  // "men", "women", and "unisex" itself (see that function's own
  // doc) — so this relaxes the mono-gender rule for the whole look
  // with no other change needed here.
  let lookGender: ProductGender = requestedGender;
  const usedSellers = new Set<string>();

  const isEligible = (p: Product) => {
    const productGender = getProductGender(p);
    if (productGender === "unknown") return false;
    if (!gendersCompatible(lookGender, productGender)) return false;
    if (p.seller?.username && usedSellers.has(p.seller.username)) return false;
    return true;
  };

  return results.map(({ component, products }) => {
    // gendersCompatible treats an "unknown" lookGender as compatible
    // with anything, so before the look's gender is established this
    // simply picks products[0] (unchanged behavior for the first
    // determinable component, seller permitting). Once established, it
    // skips ahead to the first already-fetched candidate that's
    // actually eligible — never silently falling back to a mismatched
    // gender or an already-used seller.
    const product = products.find(isEligible) ?? null;
    if (product) {
      const productGender = getProductGender(product);
      if (lookGender === "unknown" && productGender !== "unknown") lookGender = productGender;
      if (product.seller?.username) usedSellers.add(product.seller.username);
    }
    // Alternatives are also filtered against the (now possibly just-
    // established) look gender and used-sellers set — the "Change"
    // button on the /look page swaps a component's product for its
    // first alternative with no check of its own, so an unfiltered
    // list here would let a manual Change reintroduce either violation.
    const alternatives = products.filter((p) => (!product || p.id !== product.id) && isEligible(p));
    return {
      role: component.role,
      searchQuery: component.searchQuery,
      productId: product?.id ?? null,
      product,
      alternatives,
    };
  });
}

class AIProductLookGenerator implements LookGenerator {
  async generateLook(context: LookContext): Promise<GeneratedLook> {
    let rawPlan: unknown;
    try {
      rawPlan = await generateJsonObject(
        LOOK_SYSTEM_PROMPT.replace("{{LOCALE}}", context.locale).replace("{{GENDER}}", context.gender),
        contextForPrompt(context),
      );
    } catch (err) {
      throw new LookGeneratorError(
        `AI look planning failed: ${err instanceof Error ? err.message : "unknown error"}`,
      );
    }

    const parsed = LookPlanSchema.safeParse(rawPlan);
    if (!parsed.success) {
      throw new LookGeneratorError(
        `AI look plan failed validation: ${parsed.error.message}`,
      );
    }

    // The current eBay integration is EBAY_US, so do not force EUR
    // priceCurrency filters against a US marketplace. Budget ceilings
    // remain soft until the marketplace/FX layer is added.
    const currency = null;
    const deliveryCountry =
      context.current.location?.country ??
      context.profile.location?.country ??
      null;

    // The AI plan's own per-component maxPrice is the only price signal
    // this pipeline used to send to eBay — nothing ever enforced the
    // user's selected budget band (BUDGET_RANGE_BOUNDS) itself, so a
    // "700+" selection could silently return an outfit costing a
    // fraction of that. profileBudgetText tells the model the band is a
    // *total*, so split it evenly across however many components the
    // model planned and pass that as a real per-component floor to
    // eBay — the same "server-side filter as a soft hint" pattern
    // candidateSource.ts already uses for Explore.
    const componentCount = parsed.data.components.length;

    const results = await Promise.all(
      parsed.data.components.map(async (component) => {
        try {
          const { minPrice, maxPrice } = computeComponentSearchPriceBounds(
            component.maxPrice ?? null,
            context.profile.budgetRange,
            componentCount,
          );
          const products = await productSearchProvider.search({
            query: `${component.searchQuery} ${
              context.gender === "women" ? "women's" : context.gender === "men" ? "men's" : "unisex"
            }`,
            color: component.color ?? null,
            maxPrice,
            minPrice,
            currency,
            deliveryCountry,
          });
          return { component, products: products.slice(0, 8) };
        } catch (err) {
          console.error(
            `[Compass] look component search failed role="${component.role}"`,
            err,
          );
          return { component, products: [] as Product[] };
        }
      }),
    );

    const components = selectConsistentComponents(results, context.gender).filter((component) => component.product);

    const priced = components
      .map((component) => component.product)
      .filter((product): product is Product => Boolean(product));

    return {
      title: parsed.data.title,
      description: parsed.data.description,
      components,
      totalPrice:
        priced.length > 0
          ? priced.reduce((sum, product) => sum + product.price, 0)
          : null,
      currency: priced[0]?.currency ?? currency,
      styleNotes: parsed.data.styleNotes ?? [],
    };
  }
}

export const lookGenerator: LookGenerator = new AIProductLookGenerator();

export interface UserPreferenceSignalRecorder {
  record(signal: PreferenceSignal): Promise<void>;
}

class NoopPreferenceSignalRecorder implements UserPreferenceSignalRecorder {
  async record(): Promise<void> {}
}

export const preferenceSignalRecorder: UserPreferenceSignalRecorder =
  new NoopPreferenceSignalRecorder();
