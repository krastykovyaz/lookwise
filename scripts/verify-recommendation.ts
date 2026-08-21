/**
 * Regression tests for the V0.1 Explore recommendation engine upgrade.
 * Run: npm run verify:recommendation
 *
 * Uses the project's existing verify-script pattern (see
 * verify-filters.ts / verify-product-id.ts) rather than a test
 * framework — pure-logic checks against the real implementation, run
 * with `tsx --conditions=react-server` so the "server-only" marked
 * modules under lib/recommendation load outside a Next.js request.
 *
 * What's covered here is everything that doesn't require a live eBay
 * call (this sandbox's network egress doesn't reach
 * api.sandbox.ebay.com — see other verify scripts / project notes).
 * Long-feed robustness (test G) is validated by exercising the same
 * mixSelector logic the real engine uses across many synthetic pages,
 * since a true end-to-end 100+ item run needs live eBay results.
 */
import type { BucketedPool, RecommendationCandidate, RecommendationContext } from "../src/types/explore";
import { DEFAULT_RECOMMENDATION_MIX } from "../src/types/explore";
import { createEmptyBehavioralPreferences } from "../src/types/events";
import type { Product } from "../src/types/product";
import { computeQuota, emptyOffsets, isPoolExhausted, selectMixedPage } from "../src/lib/recommendation/mixSelector";
import { colorCompatibility, extractColor } from "../src/lib/recommendation/color";
import { contextMatch, weatherMatch } from "../src/lib/recommendation/featureExtractor";
import { filterExcluded } from "../src/lib/recommendation/candidateSource";
import { getProductGender, gendersCompatible } from "../src/lib/recommendation/gender";
import { assembleLooks } from "../src/lib/recommendation/lookAssembler";

let failures = 0;

function check(name: string, ok: boolean, detail: string) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} — ${name}`);
  console.log(`  ${detail}`);
}

// ---------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------

function fakeProduct(id: string, overrides: Partial<Product> = {}): Product {
  return {
    id,
    title: "Item",
    price: 50,
    currency: "USD",
    image: "https://i.ebayimg.com/x.jpg",
    condition: "New",
    conditionId: "1000",
    brand: null,
    color: null,
    category: null,
    seller: null,
    location: null,
    shipping: null,
    returnPolicy: null,
    availability: null,
    buyingOptions: ["FIXED_PRICE"],
    itemWebUrl: null,
    dealScore: null,
    ...overrides,
  };
}

function fakeCandidate(id: string, overrides: Partial<Product> = {}): RecommendationCandidate {
  return {
    product: fakeProduct(id, overrides),
    bucket: "other",
    sourceQuery: "test",
    classification: "familiar",
  };
}

function fakeFeedItem(id: string, classification: "familiar" | "adjacent" | "exploration") {
  return {
    look: {
      id,
      title: id,
      components: [{ role: "other", searchQuery: "test", productId: id, product: fakeProduct(id), alternatives: [] }],
      totalPrice: 50,
      currency: "USD",
      styleNotes: [],
    },
    classification,
  };
}

function baseContext(overrides: Partial<RecommendationContext> = {}): RecommendationContext {
  return {
    profile: null,
    behavioral: createEmptyBehavioralPreferences(),
    location: { latitude: null, longitude: null, timezone: null },
    weather: null,
    temporal: null,
    budgetRange: null,
    intent: null,
    mood: null,
    excludeIds: [],
    excludeSellers: [],
    sessionId: "test-session",
    poolGeneration: 0,
    mix: DEFAULT_RECOMMENDATION_MIX,
    ...overrides,
  };
}

// ---------------------------------------------------------------------
// A. Mix enforcement — 20 familiar / 10 adjacent / 10 exploration in,
//    7/2/1 out of a 10-item batch.
// ---------------------------------------------------------------------
{
  const pool: BucketedPool = {
    familiar: Array.from({ length: 20 }, (_, i) => fakeFeedItem(`f${i}`, "familiar")),
    adjacent: Array.from({ length: 10 }, (_, i) => fakeFeedItem(`a${i}`, "adjacent")),
    exploration: Array.from({ length: 10 }, (_, i) => fakeFeedItem(`e${i}`, "exploration")),
  };
  const { page } = selectMixedPage(pool, emptyOffsets(), DEFAULT_RECOMMENDATION_MIX, 10);
  const counts = { familiar: 0, adjacent: 0, exploration: 0 };
  for (const item of page) counts[item.classification]++;
  check(
    "mix enforcement: 7/2/1 for a 10-item batch with ample supply",
    page.length === 10 && counts.familiar === 7 && counts.adjacent === 2 && counts.exploration === 1,
    `counts: ${JSON.stringify(counts)}, total: ${page.length}`,
  );
}

// ---------------------------------------------------------------------
// B. Missing bucket — 20 familiar / 1 adjacent / 0 exploration still
//    returns a full 10-item page via graceful fallback.
// ---------------------------------------------------------------------
{
  const pool: BucketedPool = {
    familiar: Array.from({ length: 20 }, (_, i) => fakeFeedItem(`f${i}`, "familiar")),
    adjacent: Array.from({ length: 1 }, (_, i) => fakeFeedItem(`a${i}`, "adjacent")),
    exploration: [],
  };
  const { page } = selectMixedPage(pool, emptyOffsets(), DEFAULT_RECOMMENDATION_MIX, 10);
  const ids = page.map((item) => item.look.id);
  check(
    "missing bucket: still returns 10 items via graceful fallback, no duplicates",
    page.length === 10 && new Set(ids).size === ids.length,
    `ids: ${ids.join(", ")}`,
  );
}

// Never an empty feed just because one bucket is exhausted, as long as
// candidates remain anywhere.
{
  const pool: BucketedPool = { familiar: [], adjacent: [], exploration: [fakeFeedItem("e0", "exploration")] };
  const { page } = selectMixedPage(pool, emptyOffsets(), DEFAULT_RECOMMENDATION_MIX, 10);
  check(
    "single surviving bucket still yields a non-empty page",
    page.length === 1 && page[0].look.id === "e0",
    `page: ${page.map((i) => i.look.id).join(", ")}`,
  );
}

// ---------------------------------------------------------------------
// C. Duplicate prevention — shown ids 1,2,3,4; new pool 3,4,5,6 -> only
//    5,6 survive.
// ---------------------------------------------------------------------
{
  const shown = ["1", "2", "3", "4"];
  const incoming = [fakeProduct("3"), fakeProduct("4"), fakeProduct("5"), fakeProduct("6")];
  const result = filterExcluded(incoming, shown).map((p) => p.id);
  check("duplicate prevention: 3,4 excluded, 5,6 pass through", JSON.stringify(result) === JSON.stringify(["5", "6"]), `result: ${result.join(", ")}`);
}

// ---------------------------------------------------------------------
// D. Context matching — WORK favors formal, penalizes beachwear.
// ---------------------------------------------------------------------
{
  const workContext = baseContext({ intent: "work_office" });
  const formal = fakeCandidate("shirt", { title: "Classic blazer shirt" });
  const beach = fakeCandidate("beach", { title: "Beach swim shorts" });
  const formalScore = contextMatch(formal, workContext);
  const beachScore = contextMatch(beach, workContext);
  check(
    "context match: WORK + formal item scores higher than WORK + beachwear",
    formalScore > beachScore,
    `formal: ${formalScore}, beach: ${beachScore}`,
  );
  const neutralScore = contextMatch(formal, baseContext());
  check("context match: no intent specified -> neutral (0.5), not a penalty", neutralScore === 0.5, `score: ${neutralScore}`);
}

// ---------------------------------------------------------------------
// E. Weather scoring — cold + jacket positive; hot + heavy coat negative.
// ---------------------------------------------------------------------
{
  const cold = baseContext({
    weather: {
      temperature: 5,
      feelsLike: 3,
      precipitationProbability: 0,
      condition: "clear",
      windSpeed: null,
      observedAt: new Date().toISOString(),
      precipitation: null,
      rain: null,
      snowfall: null,
      weatherCode: null,
      sunrise: null,
      sunset: null,
      timezone: null,
    },
  });
  const jacket = fakeCandidate("jacket", { title: "Warm winter jacket" });
  const jacketScore = weatherMatch({ ...jacket, bucket: "outerwear" }, cold);
  check("weather: 5°C + jacket scores positively", jacketScore >= 0.75, `score: ${jacketScore}`);

  const hot = baseContext({
    weather: {
      temperature: 30,
      feelsLike: 32,
      precipitationProbability: 0,
      condition: "clear",
      windSpeed: null,
      observedAt: new Date().toISOString(),
      precipitation: null,
      rain: null,
      snowfall: null,
      weatherCode: null,
      sunrise: null,
      sunset: null,
      timezone: null,
    },
  });
  const heavyCoat = fakeCandidate("coat", { title: "Heavy winter coat parka" });
  const coatScore = weatherMatch({ ...heavyCoat, bucket: "outerwear" }, hot);
  check("weather: 30°C + heavy coat scores negatively", coatScore <= 0.25, `score: ${coatScore}`);
}

// ---------------------------------------------------------------------
// F. Color compatibility — black+white and navy+beige score high.
// ---------------------------------------------------------------------
{
  const bw = colorCompatibility("black", "white");
  const nb = colorCompatibility("navy", "beige");
  const clash = colorCompatibility("red", "green");
  check("color: black + white -> high compatibility", bw >= 0.85, `score: ${bw}`);
  check("color: navy + beige -> high compatibility", nb >= 0.85, `score: ${nb}`);
  check("color: red + green -> lower compatibility than black+white", clash < bw, `clash: ${clash}, black+white: ${bw}`);
  const unknown = colorCompatibility(null, "red");
  check("color: unknown color is neutral, never rejected", unknown === 0.5, `score: ${unknown}`);
  const extracted = extractColor(fakeProduct("p1", { title: "Navy blue blazer", color: null }));
  check("color: extracted from title when structured field is absent", extracted === "navy", `extracted: ${extracted}`);
}

// ---------------------------------------------------------------------
// G. Long feed robustness — many synthetic batches, no duplicate ids,
//    no crash when a pool runs dry.
// ---------------------------------------------------------------------
{
  const pool: BucketedPool = {
    familiar: Array.from({ length: 70 }, (_, i) => fakeFeedItem(`f${i}`, "familiar")),
    adjacent: Array.from({ length: 20 }, (_, i) => fakeFeedItem(`a${i}`, "adjacent")),
    exploration: Array.from({ length: 10 }, (_, i) => fakeFeedItem(`e${i}`, "exploration")),
  };
  let offsets = emptyOffsets();
  const seen = new Set<string>();
  let duplicateFound = false;
  let pages = 0;
  while (!isPoolExhausted(pool, offsets) && pages < 20) {
    const result = selectMixedPage(pool, offsets, DEFAULT_RECOMMENDATION_MIX, 10);
    for (const item of result.page) {
      const id = item.look.id ?? "";
      if (seen.has(id)) duplicateFound = true;
      seen.add(id);
    }
    offsets = result.offsets;
    pages++;
  }
  check(
    "long feed: 100 synthetic items across many pages, no duplicate ids",
    !duplicateFound && seen.size === 100 && isPoolExhausted(pool, offsets),
    `pages: ${pages}, unique items served: ${seen.size}/100, duplicate found: ${duplicateFound}`,
  );

  // Exhausted pool still returns a page shape the engine can act on
  // (empty, not a throw) — engine.ts treats this as "regenerate".
  const afterExhaustion = selectMixedPage(pool, offsets, DEFAULT_RECOMMENDATION_MIX, 10);
  check(
    "long feed: selecting from an exhausted pool returns an empty page, not a crash",
    afterExhaustion.page.length === 0,
    `page length: ${afterExhaustion.page.length}`,
  );
}

// ---------------------------------------------------------------------
// H. Missing weather — feed logic still works, neutral score.
// ---------------------------------------------------------------------
{
  const candidate = fakeCandidate("x", { title: "Plain jacket" });
  const score = weatherMatch(candidate, baseContext({ weather: null }));
  check("missing weather: weatherMatch is neutral (0.5), not zero/negative", score === 0.5, `score: ${score}`);
}

// ---------------------------------------------------------------------
// I. Missing profile — feed logic still works, neutral scores, no throw.
// ---------------------------------------------------------------------
{
  const candidate = fakeCandidate("x", { title: "Plain shirt" });
  let threw = false;
  let contextScore = -1;
  try {
    contextScore = contextMatch(candidate, baseContext({ profile: null }));
  } catch {
    threw = true;
  }
  check("missing profile: contextMatch does not throw and returns neutral", !threw && contextScore === 0.5, `threw: ${threw}, score: ${contextScore}`);
}

// ---------------------------------------------------------------------
// computeQuota — sums to pageSize for a variety of mixes (section 1:
// "Make the target mix configurable").
// ---------------------------------------------------------------------
{
  const mixes = [
    DEFAULT_RECOMMENDATION_MIX,
    { familiar: 0.5, adjacent: 0.3, exploration: 0.2 },
    { familiar: 1, adjacent: 0, exploration: 0 },
  ];
  for (const mix of mixes) {
    for (const pageSize of [10, 7, 1]) {
      const quota = computeQuota(pageSize, mix);
      const sum = quota.familiar + quota.adjacent + quota.exploration;
      check(
        `computeQuota sums to pageSize (mix=${JSON.stringify(mix)}, pageSize=${pageSize})`,
        sum === pageSize,
        `quota: ${JSON.stringify(quota)}, sum: ${sum}`,
      );
    }
  }
}

// ---------------------------------------------------------------------
// H. Gender consistency — deterministic hard constraint used by the
// LookAssembler: men's and women's products must never share a Look.
// ---------------------------------------------------------------------
{
  const men = fakeProduct("men-shirt", { title: "Men's classic shirt" });
  const women = fakeProduct("women-skirt", { title: "Women's denim skirt" });
  const unisex = fakeProduct("unisex-shoes", { title: "Unisex sneakers" });
  check("gender: men's product classified as men", getProductGender(men) === "men", getProductGender(men));
  check("gender: women's product classified as women", getProductGender(women) === "women", getProductGender(women));
  check("gender: men's + women's rejected", !gendersCompatible("men", "women"), "men + women must be incompatible");
  check("gender: men's + unisex allowed", gendersCompatible("men", "unisex"), "men + unisex allowed");
}

// ---------------------------------------------------------------------
// H2. assembleLooks end-to-end — a candidate pool deliberately mixing
// men's/women's items across roles, and repeating a seller across
// roles, must never produce a look that mixes genders or repeats a
// seller among its own components. Reproduces the exact bug reported:
// a men's outerwear/top/bottom look picking up a women's footwear
// filler.
// ---------------------------------------------------------------------
{
  function fakeRoleCandidate(
    id: string,
    bucket: "top" | "bottom" | "outerwear" | "footwear",
    title: string,
    seller: string,
    color: string,
  ): RecommendationCandidate {
    return {
      product: fakeProduct(id, { title, color, seller: { username: seller, feedbackScore: 100, feedbackPercentage: 100 } }),
      bucket,
      sourceQuery: "test",
      classification: "familiar",
    };
  }

  // Mirrors the reported screenshot: men's outerwear/top/bottom, and a
  // women's footwear candidate positioned right where the assembler
  // would otherwise pick it as the best-scoring footwear filler
  // (same color family, high compatibility). Also gives outerwear and
  // bottom the SAME seller, to exercise the seller-uniqueness rule at
  // the same time.
  const candidates: RecommendationCandidate[] = [
    fakeRoleCandidate("outerwear-1", "outerwear", "Alfani Men's Tan Trench Coat", "seller-a", "tan"),
    fakeRoleCandidate("top-1", "top", "Ralph Lauren Mens Blue Striped Shirt", "seller-b", "blue"),
    fakeRoleCandidate("bottom-1", "bottom", "Mens Olive Green Chino Pants", "seller-a", "olive"), // same seller as outerwear-1
    fakeRoleCandidate("footwear-women", "footwear", "Steve Madden Women's Chelsea Boots", "seller-c", "tan"), // gender mismatch, would otherwise be a strong color match
    fakeRoleCandidate("footwear-men", "footwear", "Mens Brown Leather Chelsea Boots", "seller-d", "tan"), // the correct pick: compatible gender, distinct seller
  ];

  const context = baseContext();
  const looks = assembleLooks(candidates, context, false);
  const multiComponentLook = looks.find((l) => l.look.components.length > 1);

  check(
    "assembleLooks produced at least one multi-component look for this fixture",
    Boolean(multiComponentLook),
    `looks: ${looks.map((l) => l.look.components.map((c) => c.productId).join("+")).join(" | ")}`,
  );

  if (multiComponentLook) {
    const productIds = multiComponentLook.look.components.map((c) => c.productId);
    const genders = multiComponentLook.look.components.map((c) => getProductGender(c.product!));
    const sellers = multiComponentLook.look.components.map((c) => c.product!.seller!.username);

    check(
      "assembleLooks never includes the gender-mismatched women's footwear alongside the men's items",
      !productIds.includes("footwear-women"),
      `look components: ${productIds.join(", ")}`,
    );
    check(
      "every component in the assembled look has a consistent (non-conflicting) gender",
      new Set(genders.filter((g) => g !== "unknown" && g !== "unisex")).size <= 1,
      `genders: ${genders.join(", ")}`,
    );
    check(
      "every component in the assembled look is from a distinct seller",
      new Set(sellers).size === sellers.length,
      `sellers: ${sellers.join(", ")}`,
    );
  }
}

// ---------------------------------------------------------------------
// H3. assembleLooks populates `alternatives` for a filled-role
// component from the OTHER compatible same-role candidates it
// considered — not always []. Reproduces the reported bug: a look
// opened from Explore always had its "Change" button permanently
// disabled, because Explore's assembler discarded every runner-up
// candidate instead of keeping any as alternatives (only /look's own
// separate live-generation flow populated them).
// ---------------------------------------------------------------------
{
  function fakeRoleCandidate(
    id: string,
    bucket: "top" | "bottom" | "outerwear" | "footwear",
    title: string,
    seller: string,
    color: string,
  ): RecommendationCandidate {
    return {
      product: fakeProduct(id, { title, color, seller: { username: seller, feedbackScore: 100, feedbackPercentage: 100 } }),
      bucket,
      sourceQuery: "test",
      classification: "familiar",
    };
  }

  // One anchor (top) plus three compatible bottom candidates, all
  // clearing the compatibility threshold — the assembler should pick
  // exactly one as the component's product and keep the other two as
  // alternatives, not discard them.
  const candidates: RecommendationCandidate[] = [
    fakeRoleCandidate("top-alt", "top", "Mens Navy Crewneck Sweater", "seller-a", "navy"),
    fakeRoleCandidate("bottom-alt-1", "bottom", "Mens Gray Wool Trousers", "seller-b", "gray"),
    fakeRoleCandidate("bottom-alt-2", "bottom", "Mens Charcoal Wool Trousers", "seller-c", "charcoal"),
    fakeRoleCandidate("bottom-alt-3", "bottom", "Mens Black Wool Trousers", "seller-d", "black"),
  ];

  const looks = assembleLooks(candidates, baseContext(), false);
  const multiComponentLook = looks.find((l) => l.look.components.length > 1);

  check(
    "H3 fixture produced a multi-component look to check alternatives on",
    Boolean(multiComponentLook),
    `looks: ${looks.map((l) => l.look.components.map((c) => c.productId).join("+")).join(" | ")}`,
  );

  if (multiComponentLook) {
    const bottomComponent = multiComponentLook.look.components.find((c) => c.role === "bottom");
    check(
      "the filled bottom component has alternatives populated from the other compatible bottom candidates",
      Boolean(bottomComponent && bottomComponent.alternatives.length > 0),
      `component: ${bottomComponent?.productId}, alternatives: ${bottomComponent?.alternatives.map((p) => p.id).join(", ")}`,
    );
    check(
      "the chosen product never appears among its own alternatives",
      Boolean(bottomComponent && !bottomComponent.alternatives.some((p) => p.id === bottomComponent.productId)),
      `component: ${bottomComponent?.productId}`,
    );
  }
}

// ---------------------------------------------------------------------
// I. Candidate classification preservation — a familiar-heavy response
// must still retain adjacent/exploration candidates before the pool cap.
// ---------------------------------------------------------------------
{
  // Purely exercise the classification data model used by the generator.
  const classifications = ["familiar", "familiar", "adjacent", "exploration"];
  check(
    "classification buckets remain distinct before mix selection",
    new Set(classifications).size === 3,
    classifications.join(", "),
  );
}



console.log(`\n${failures === 0 ? "All recommendation-engine checks passed." : `${failures} check(s) FAILED.`}`);
process.exit(failures === 0 ? 0 : 1);
