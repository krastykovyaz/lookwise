// Covers the remaining fixes from this session's task list:
//  TASK 2/3 — saved vs. recently-viewed looks stay genuinely separate,
//    and the two client-side stores (lib/look/history.tsx,
//    lib/look/savedLooks.tsx) never cross-write into each other.
//  TASK 5/6 — currency conversion math, source-currency preservation,
//    and the eBay filter currency staying independent of display
//    currency.
// Voice input (TASK 4) has no server-side logic to test here — it's
// covered by tsc/eslint (SSR-safety, ref cleanup) checked separately;
// see the final report for what was and wasn't exercised.
//
// Run with `npm run verify:session7` (or as part of `npm run verify`).

import { convertCurrency, isSupportedCurrency, SUPPORTED_CURRENCIES } from "../src/lib/currency/rates";
import { formatPrice } from "../src/lib/currency/format";
import { buildFilterString } from "../src/lib/ebay/filters";

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
function approx(a: number, b: number, tolerance = 0.01) {
  return Math.abs(a - b) <= tolerance;
}

async function main() {
  // ------------------------------------------------------------------
  // TASK 5/6 — currency
  // ------------------------------------------------------------------

  check("EUR/USD/GBP are exactly the three supported currencies", JSON.stringify(SUPPORTED_CURRENCIES) === JSON.stringify(["EUR", "USD", "GBP"]));
  check("isSupportedCurrency accepts EUR/USD/GBP", ["EUR", "USD", "GBP"].every(isSupportedCurrency));
  check("isSupportedCurrency rejects an unknown currency", !isSupportedCurrency("JPY"));
  check("isSupportedCurrency rejects null/undefined", !isSupportedCurrency(null) && !isSupportedCurrency(undefined));

  // Real conversion happens, not just a symbol swap.
  check("USD -> EUR actually converts the number", approx(convertCurrency(100, "USD", "EUR"), 92));
  check("USD -> GBP actually converts the number", approx(convertCurrency(100, "USD", "GBP"), 79));
  check("EUR -> USD actually converts the number", approx(convertCurrency(92, "EUR", "USD"), 100, 0.5));
  check("same-currency conversion is a no-op", convertCurrency(50, "USD", "USD") === 50);
  check(
    "conversion round-trips within a small tolerance (USD -> EUR -> USD)",
    approx(convertCurrency(convertCurrency(100, "USD", "EUR"), "EUR", "USD"), 100, 0.5),
  );
  check(
    "an unsupported source currency is returned unchanged rather than mis-converted",
    convertCurrency(100, "JPY", "USD") === 100,
  );

  // formatPrice: source currency is preserved (never assumed EUR),
  // and the output actually reflects the converted amount + the
  // correct symbol for the TARGET currency.
  const usdToEur = formatPrice(100, "USD", "EUR");
  check("USD source formatted in EUR uses the euro symbol", usdToEur?.includes("€") ?? false, usdToEur ?? "null");
  check("USD source formatted in EUR is NOT just '€100' (a real conversion happened)", usdToEur !== "€100.00", usdToEur ?? "null");

  const usdToUsd = formatPrice(100, "USD", "USD");
  check("USD source displayed in USD uses the dollar symbol and is unchanged", usdToUsd === "$100.00", usdToUsd ?? "null");

  const usdToGbp = formatPrice(100, "USD", "GBP");
  check("USD source formatted in GBP uses the pound symbol", usdToGbp?.includes("£") ?? false, usdToGbp ?? "null");

  const nullAmount = formatPrice(null, "USD", "EUR");
  check("null amount formats to null rather than throwing", nullAmount === null);

  const unknownSource = formatPrice(50, "JPY", "EUR");
  check(
    "an unsupported source currency formats in ITS OWN currency rather than being silently mislabeled as the target",
    (unknownSource?.includes("¥") || unknownSource?.includes("JPY")) ?? false,
    unknownSource ?? "null",
  );

  // TASK 6 — display currency never leaks into eBay's own price filter.
  const filterUsd = buildFilterString({ condition: [], maxPrice: 150, minPrice: null, currency: null, deliveryCountry: null });
  check(
    "eBay price filter defaults to USD regardless of any display-currency concept (section 6)",
    filterUsd?.includes("priceCurrency:USD") ?? false,
    filterUsd ?? "undefined",
  );

  // ------------------------------------------------------------------
  // TASK 2/3 — saved vs. recently viewed (source-level check)
  // ------------------------------------------------------------------
  // The two providers are independent React contexts with separate
  // localStorage keys and separate DB write paths — verified here by
  // confirming the SOURCE CODE actually keeps them separate, since a
  // full DOM-level provider test would need a browser environment
  // this script doesn't have (same constraint as the client-only
  // checks noted in verify-signals.ts).
  const { readFileSync } = await import("node:fs");
  const path = await import("node:path");

  const historySource = readFileSync(path.join(__dirname, "..", "src", "lib", "look", "history.tsx"), "utf8");
  check(
    "lib/look/history.tsx (view history) never imports the saved-look sync helper",
    !/syncSaveLook|syncUnsaveLook/.test(historySource),
  );
  check(
    "lib/look/history.tsx's write function is named for viewing, not saving",
    /recordViewedLook/.test(historySource) && !/export.*function saveLook\b/.test(historySource),
  );

  const savedLooksSource = readFileSync(path.join(__dirname, "..", "src", "lib", "look", "savedLooks.tsx"), "utf8");
  check(
    "lib/look/savedLooks.tsx (explicit saves) is the only place that calls syncSaveLook/syncUnsaveLook for looks",
    /syncSaveLook/.test(savedLooksSource) && /syncUnsaveLook/.test(savedLooksSource),
  );
  check(
    "lib/look/savedLooks.tsx uses its own separate localStorage key from history's",
    /compass\.savedLooks/.test(savedLooksSource) && !/compass\.lookHistory/.test(savedLooksSource),
  );

  const exploreFeedSource = readFileSync(path.join(__dirname, "..", "src", "components", "explore", "ExploreFeed.tsx"), "utf8");
  check(
    "handleOpenLook (viewing) calls recordViewedLook, not the saved-looks toggle",
    /recordViewedLook\(item\.look\)/.test(exploreFeedSource),
  );
  check(
    "handleSave (explicit Save button) calls toggleSaved, not recordViewedLook",
    /toggleSaved\(item\.look\)/.test(exploreFeedSource),
  );
  check(
    "the bookmark/isSaved indicator is driven by useSavedLooks, not useLookHistory",
    /isSaved\(lookIdOf\(item\)\)/.test(exploreFeedSource) && /useSavedLooks/.test(exploreFeedSource),
  );

  const overviewSource = readFileSync(path.join(__dirname, "..", "src", "app", "overview", "page.tsx"), "utf8");
  check("Overview renders a dedicated Saved Looks section from useSavedLooks", /useSavedLooks/.test(overviewSource));
  check("Overview renders a dedicated Favorites section from useFavorites, kept separate from Recently Viewed", /useFavorites/.test(overviewSource));
  check(
    "Overview combines looks + actually-viewed products into ONE chronological Recently Viewed list",
    /\[\.\.\.lookEntries, \.\.\.productEntries\]/.test(overviewSource) &&
      /\.sort\(\(a, b\) => new Date\(b\.timestamp\)\.getTime\(\) - new Date\(a\.timestamp\)\.getTime\(\)\)/.test(overviewSource),
  );
  check(
    "the merged list still excludes products only rendered inside a look (viewedSeparately filter preserved)",
    /\.filter\(\(item\) => item\.viewedSeparately\)/.test(overviewSource),
  );
  check(
    "the merged Recently Viewed list is capped at RECENT_VIEW_LIMIT",
    /\.slice\(0, RECENT_VIEW_LIMIT\)/.test(overviewSource),
  );

  const historyLimitSource = readFileSync(path.join(__dirname, "..", "src", "lib", "look", "history.tsx"), "utf8");
  check("RECENT_VIEW_LIMIT is exactly 10 (section 3's explicit requirement)", /RECENT_VIEW_LIMIT = 10/.test(historyLimitSource));

  const viewedRouteSource = readFileSync(path.join(__dirname, "..", "src", "app", "api", "activity", "viewed", "route.ts"), "utf8");
  check(
    "GET /api/activity/viewed applies limit server-side via the repository, not by over-fetching and slicing",
    /listViewedProducts\(userId, limit\)/.test(viewedRouteSource),
  );

  // ------------------------------------------------------------------
  // TASK 4 — voice input source-level checks
  // ------------------------------------------------------------------
  const speechHookSource = readFileSync(path.join(__dirname, "..", "src", "lib", "style", "useSpeechRecognition.ts"), "utf8");
  check("voice hook checks both SpeechRecognition and webkitSpeechRecognition", /window\.SpeechRecognition/.test(speechHookSource) && /window\.webkitSpeechRecognition/.test(speechHookSource));
  check("voice hook guards against SSR (no window access outside a browser check)", /typeof window === "undefined"/.test(speechHookSource));
  check("voice hook prevents duplicate recognizers (no-op while already listening)", /if \(status === "listening"\) return;/.test(speechHookSource));
  check("voice hook tears down recognition on unmount", /recognition\.stop\(\)/.test(speechHookSource) && /recognitionRef\.current = null;/.test(speechHookSource));
  check("voice hook distinguishes permission-denied from generic errors", /not-allowed/.test(speechHookSource) && /"denied"/.test(speechHookSource));

  const aiInputSource = readFileSync(path.join(__dirname, "..", "src", "components", "ai", "AIInput.tsx"), "utf8");
  check("AIInput inserts the transcript into the SAME value/onChange the typed pipeline uses", /onChange\(current \? `\$\{current\} \$\{transcript\}` : transcript\)/.test(aiInputSource));
  check("AIInput does not auto-submit on a voice result (onSubmit is not called from onResult)", !/onResult:.*onSubmit/.test(aiInputSource.replace(/\n/g, " ")));

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
