/**
 * Regression test for real eBay item ids (they contain pipes).
 * Run: npm run verify:product-id
 */
import { buildItemUrl } from "../src/lib/ebay/browse";
import { ebayBaseUrl } from "../src/lib/ebay/env";

const ID = "v1|110589983217|0";
let failures = 0;

function check(name: string, ok: boolean, detail: string) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} — ${name}`);
  console.log(`  ${detail}`);
}

// 1. encode -> decode round trip returns the exact original id.
const encoded = encodeURIComponent(ID);
check(
  "encodeURIComponent -> decodeURIComponent round trip",
  decodeURIComponent(encoded) === ID,
  `encoded: ${encoded} | decoded: ${decodeURIComponent(encoded)}`,
);

// 2. The encoded form actually escapes the pipes.
check(
  "pipes are percent-encoded (%7C) in the URL form",
  encoded === "v1%7C110589983217%7C0" && !encoded.includes("|"),
  `encoded: ${encoded}`,
);

// 3. The product page href built by ProductCard round trips too.
const href = `/product/${encodeURIComponent(ID)}`;
check(
  "product page href decodes back to the original id",
  decodeURIComponent(href.replace("/product/", "")) === ID,
  `href: ${href}`,
);

// 4. The eBay API URL uses exactly one encoded path segment, no double encoding.
const url = buildItemUrl(ID);
const segment = url.split("/buy/browse/v1/item/")[1];
check(
  "eBay item URL has a single encoded path segment",
  url === `${ebayBaseUrl()}/buy/browse/v1/item/${encoded}` &&
    !segment.includes("/") &&
    !segment.includes("%25") && // %25 would mean the '%' itself was encoded again
    decodeURIComponent(segment) === ID,
  `url: ${url}`,
);

// 5. Double encoding is detectably different — guards against a future regression.
check(
  "double-encoded id does NOT match the built URL",
  buildItemUrl(ID) !== `${ebayBaseUrl()}/buy/browse/v1/item/${encodeURIComponent(encoded)}`,
  `double-encoded would be: ${encodeURIComponent(encoded)}`,
);

console.log(`\n${failures === 0 ? "All product-id checks passed." : `${failures} check(s) FAILED.`}`);
process.exit(failures === 0 ? 0 : 1);
