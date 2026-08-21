import { buildFilterString } from "../src/lib/ebay/filters";

function check(name: string, actual: string | undefined, expectedParts: string[]) {
  const actualParts = (actual ?? "").split(",");
  const missing = expectedParts.filter((p) => !actualParts.includes(p));
  const ok = missing.length === 0;
  console.log(`${ok ? "PASS" : "FAIL"} — ${name}`);
  console.log(`  built:    ${actual}`);
  if (!ok) console.log(`  missing:  ${missing.join(", ")}`);
}

// 1. conditionIds:{3000} — verified working filter for "used/pre-owned"
check(
  "condition filter (pre-owned -> 3000)",
  buildFilterString({
    condition: ["used", "pre-owned", "very good"],
    maxPrice: null,
    currency: null,
    deliveryCountry: null,
  }),
  ["conditionIds:{3000}"],
);

// 2. deliveryCountry:US — verified working
check(
  "delivery country filter (US)",
  buildFilterString({
    condition: [],
    maxPrice: null,
    currency: null,
    deliveryCountry: "US",
  }),
  ["deliveryCountry:US"],
);

// 3. price:[0..20],priceCurrency:USD — verified working; price REQUIRES priceCurrency
check(
  "price filter requires priceCurrency (shoes under $20)",
  buildFilterString({
    condition: [],
    maxPrice: 20,
    currency: "USD",
    deliveryCountry: null,
  }),
  ["price:[0..20]", "priceCurrency:USD"],
);

// 4. Combined: conditionIds + deliveryCountry, matching the verified
//    combined example from the spec.
check(
  "combined conditionIds + deliveryCountry",
  buildFilterString({
    condition: ["used"],
    maxPrice: null,
    currency: null,
    deliveryCountry: "US",
  }),
  ["conditionIds:{3000}", "deliveryCountry:US"],
);

// 5. "new" condition maps to 1000, not 3000.
check(
  "new condition -> 1000",
  buildFilterString({
    condition: ["new"],
    maxPrice: null,
    currency: null,
    deliveryCountry: null,
  }),
  ["conditionIds:{1000}"],
);

// 6. No maxPrice -> no price/priceCurrency filter emitted at all.
{
  const built = buildFilterString({
    condition: [],
    maxPrice: null,
    currency: null,
    deliveryCountry: null,
  });
  const hasPrice = (built ?? "").includes("price:");
  console.log(`${!hasPrice ? "PASS" : "FAIL"} — no price filter when maxPrice is absent`);
  console.log(`  built: ${built}`);
}

// 7. maxPrice without explicit currency defaults to USD (never omits
//    priceCurrency, which eBay requires).
check(
  "maxPrice without currency still includes priceCurrency",
  buildFilterString({
    condition: [],
    maxPrice: 150,
    currency: null,
    deliveryCountry: null,
  }),
  ["price:[0..150]", "priceCurrency:USD"],
);

// 8. minPrice + maxPrice both set -> a bounded range (used by Explore's
//    budget bands like 100_200, 200_400, 400_700).
check(
  "minPrice + maxPrice -> bounded range",
  buildFilterString({
    condition: [],
    maxPrice: 200,
    minPrice: 100,
    currency: "USD",
    deliveryCountry: null,
  }),
  ["price:[100..200]", "priceCurrency:USD"],
);

// 9. minPrice with no maxPrice -> open-ended upper bound (Explore's
//    700_plus budget band).
check(
  "minPrice alone -> open-ended range",
  buildFilterString({
    condition: [],
    maxPrice: null,
    minPrice: 700,
    currency: "USD",
    deliveryCountry: null,
  }),
  ["price:[700..]", "priceCurrency:USD"],
);

// 10. Neither bound set -> still no price filter at all (Explore's
//     no_preference budget band).
{
  const built = buildFilterString({
    condition: [],
    maxPrice: null,
    minPrice: null,
    currency: null,
    deliveryCountry: null,
  });
  const hasPrice = (built ?? "").includes("price:");
  console.log(`${!hasPrice ? "PASS" : "FAIL"} — no price filter when neither minPrice nor maxPrice is set`);
  console.log(`  built: ${built}`);
}

console.log("\nDone.");
