/**
 * Regression tests for the /look AI stylist builder's cross-component
 * consistency rules: gender (never mix men's/women's items) and seller
 * (every component from a distinct seller). This is a separate
 * pipeline from Explore's assembleLooks (see lib/look/index.ts vs
 * lib/recommendation/lookAssembler.ts) — each component's product is
 * picked independently from its own eBay search, so nothing but
 * selectConsistentComponents prevents e.g. a men's outerwear/top/
 * bottom look from picking up a women's footwear filler (the exact
 * bug this was written to catch and fix).
 * Run: npm run verify:look
 */
import "server-only";
import type { Product } from "../src/types/product";
import { selectConsistentComponents, computeComponentSearchPriceBounds } from "../src/lib/look";
import { getProductGender } from "../src/lib/recommendation/gender";

let failures = 0;
function check(name: string, ok: boolean, detail: string) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} — ${name}`);
  console.log(`  ${detail}`);
}

function fakeProduct(id: string, title: string, seller: string | null): Product {
  return {
    id,
    title,
    price: 40,
    currency: "USD",
    image: "https://i.ebayimg.com/x.jpg",
    condition: "New",
    conditionId: "1000",
    brand: null,
    color: null,
    category: null,
    seller: seller ? { username: seller, feedbackScore: 100, feedbackPercentage: 100 } : null,
    location: null,
    shipping: null,
    returnPolicy: null,
    availability: null,
    buyingOptions: ["FIXED_PRICE"],
    itemWebUrl: null,
    dealScore: null,
  };
}

// ---------------------------------------------------------------------
// Reproduces the reported bug: men's outerwear/top/bottom searched
// independently, and the footwear search's top eBay result happens to
// be a women's item. Without selectConsistentComponents, generateLook
// would have taken products[0] for every role regardless of gender.
// ---------------------------------------------------------------------
{
  const results = [
    {
      component: { role: "outerwear", searchQuery: "mens trench coat" },
      products: [fakeProduct("outerwear-1", "Alfani Men's Tan Trench Coat", "seller-a")],
    },
    {
      component: { role: "top", searchQuery: "mens striped shirt" },
      products: [fakeProduct("top-1", "Ralph Lauren Mens Blue Striped Shirt", "seller-b")],
    },
    {
      component: { role: "bottom", searchQuery: "mens chino pants" },
      products: [fakeProduct("bottom-1", "Mens Olive Green Chino Pants", "seller-c")],
    },
    {
      component: { role: "footwear", searchQuery: "chelsea boots" },
      // top result is a women's item; a compatible men's one is next.
      products: [
        fakeProduct("footwear-women", "Steve Madden Women's Chelsea Boots", "seller-d"),
        fakeProduct("footwear-men", "Mens Brown Leather Chelsea Boots", "seller-e"),
      ],
    },
  ];

  const components = selectConsistentComponents(results);
  const productIds = components.map((c) => c.productId);
  const genders = components.map((c) => (c.product ? getProductGender(c.product) : "unknown"));

  check(
    "the women's footwear result is never selected once the look's gender is established as men's",
    !productIds.includes("footwear-women"),
    `selected: ${productIds.join(", ")}`,
  );
  check(
    "the gender-compatible men's footwear alternative is selected instead",
    productIds.includes("footwear-men"),
    `selected: ${productIds.join(", ")}`,
  );
  check(
    "every selected component has a consistent gender",
    new Set(genders.filter((g) => g !== "unknown" && g !== "unisex")).size <= 1,
    `genders: ${genders.join(", ")}`,
  );

  const footwear = components.find((c) => c.role === "footwear");
  check(
    "the rejected women's item is also excluded from alternatives (so the Change button can't reintroduce it)",
    !(footwear?.alternatives ?? []).some((p) => p.id === "footwear-women"),
    `alternatives: ${(footwear?.alternatives ?? []).map((p) => p.id).join(", ")}`,
  );
}

// ---------------------------------------------------------------------
// Seller uniqueness within one generated look.
// ---------------------------------------------------------------------
{
  const results = [
    { component: { role: "top", searchQuery: "t-shirt" }, products: [fakeProduct("top-1", "Men's Plain T-Shirt", "seller-x")] },
    {
      component: { role: "bottom", searchQuery: "jeans" },
      // top result is the SAME seller as the top; a distinct-seller
      // alternative is next.
      products: [
        fakeProduct("bottom-same-seller", "Men's Straight Jeans", "seller-x"),
        fakeProduct("bottom-diff-seller", "Men's Straight Jeans", "seller-y"),
      ],
    },
  ];
  const components = selectConsistentComponents(results);
  const productIds = components.map((c) => c.productId);
  const sellers = components.map((c) => c.product?.seller?.username);

  check(
    "a same-seller candidate is skipped in favor of a distinct-seller alternative",
    productIds.includes("bottom-diff-seller") && !productIds.includes("bottom-same-seller"),
    `selected: ${productIds.join(", ")}`,
  );
  check(
    "every selected component is from a distinct seller",
    new Set(sellers.filter(Boolean)).size === sellers.filter(Boolean).length,
    `sellers: ${sellers.join(", ")}`,
  );
}

// ---------------------------------------------------------------------
// No eligible candidate at all for a role (every result is either
// gender-mismatched or seller-conflicting) — the role is left empty
// (product: null) rather than ever including a known violation. The
// /look page's UI already renders this gracefully (shows the search
// query text instead of a card).
// ---------------------------------------------------------------------
{
  const results = [
    { component: { role: "top", searchQuery: "shirt" }, products: [fakeProduct("top-1", "Men's Shirt", "seller-only")] },
    {
      component: { role: "bottom", searchQuery: "pants" },
      // Both candidates conflict: one by gender, one by seller.
      products: [fakeProduct("bottom-wrong-gender", "Women's Pants", "seller-other"), fakeProduct("bottom-same-seller", "Men's Pants", "seller-only")],
    },
  ];
  const components = selectConsistentComponents(results);
  const bottom = components.find((c) => c.role === "bottom");
  check(
    "a role with no eligible candidate is left empty rather than forcing a violation",
    bottom?.product === null && bottom?.productId === null,
    `bottom component: ${JSON.stringify(bottom)}`,
  );
}

// ---------------------------------------------------------------------
// computeComponentSearchPriceBounds — the fix for a real bug: a "700+"
// budget selection previously never reached eBay as a price floor at
// all, so a generated look could cost a fraction of the selected band.
// ---------------------------------------------------------------------
{
  const openEnded = computeComponentSearchPriceBounds(35, "700_plus", 4);
  check(
    "a 700+ budget split across 4 components produces a real per-component floor",
    openEnded.minPrice === 175,
    `minPrice: ${openEnded.minPrice}`,
  );
  check(
    "a model-proposed ceiling below the computed floor is dropped, not sent as an impossible range",
    openEnded.maxPrice === null,
    `maxPrice: ${openEnded.maxPrice}`,
  );
}
{
  const compatible = computeComponentSearchPriceBounds(300, "700_plus", 4);
  check(
    "a model-proposed ceiling that's still above the floor is kept as-is",
    compatible.minPrice === 175 && compatible.maxPrice === 300,
    `minPrice: ${compatible.minPrice}, maxPrice: ${compatible.maxPrice}`,
  );
}
{
  const bounded = computeComponentSearchPriceBounds(null, "400_700", 4);
  check(
    "a bounded band (400-700, not open-ended) still floors on its min, not its max",
    bounded.minPrice === 100,
    `minPrice: ${bounded.minPrice}`,
  );
}
{
  const noBudget = computeComponentSearchPriceBounds(50, null, 3);
  check(
    "no budget selected at all -> no floor is invented, the model's own maxPrice passes through unchanged",
    noBudget.minPrice === null && noBudget.maxPrice === 50,
    `minPrice: ${noBudget.minPrice}, maxPrice: ${noBudget.maxPrice}`,
  );
}
{
  const noPreference = computeComponentSearchPriceBounds(50, "no_preference", 3);
  check(
    "explicit no_preference -> no floor either (min bound is 0)",
    noPreference.minPrice === null,
    `minPrice: ${noPreference.minPrice}`,
  );
}
{
  const underBudget = computeComponentSearchPriceBounds(20, "under_100", 4);
  check(
    "the lowest band (min: 0) never produces a floor",
    underBudget.minPrice === null && underBudget.maxPrice === 20,
    `minPrice: ${underBudget.minPrice}, maxPrice: ${underBudget.maxPrice}`,
  );
}

console.log(`\n${failures === 0 ? "All /look consistency checks passed." : `${failures} check(s) FAILED.`}`);
process.exit(failures === 0 ? 0 : 1);
