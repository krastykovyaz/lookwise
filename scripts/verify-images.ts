/**
 * Regression test for eBay image normalization.
 * Uses a representative eBay Sandbox item_summary/search payload shape.
 * Run: npm run verify:images
 */
import { normalizeSearchResults, pickImages, upscaleEbayImageUrl } from "../src/lib/ebay/normalize";
import type { EbayItemSummary } from "../src/lib/ebay/types";

let failures = 0;
function check(name: string, ok: boolean, detail: string) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} — ${name}`);
  console.log(`  ${detail}`);
}

const EBAY_IMAGE = "https://i.ebayimg.com/images/g/8YkAAOSwLuJgH0Ml/s-l1600.jpg";
const EBAY_THUMB = "https://i.ebayimg.com/images/g/8YkAAOSwLuJgH0Ml/s-l225.jpg";
const EBAY_EXTRA = "https://i.ebayimg.com/images/g/QQwAAOSwX-hgH0Mn/s-l1600.jpg";
const EBAY_EXTRA_SMALL = "https://i.ebayimg.com/images/g/QQwAAOSwX-hgH0Mn/s-l500.jpg";
// Matches the literal placeholder in src/lib/ebay/normalize.ts (not
// exported — this is what's used when eBay gives no image at all).
const PLACEHOLDER_IMAGE_FOR_TEST = "https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=800&q=80";

const withImage: EbayItemSummary = {
  itemId: "v1|110589983217|0",
  title: "Nike Air Max 90 Pre-Owned",
  price: { value: "89.99", currency: "USD" },
  condition: "Pre-owned",
  conditionId: "3000",
  image: { imageUrl: EBAY_IMAGE },
  thumbnailImages: [{ imageUrl: EBAY_THUMB }],
  additionalImages: [{ imageUrl: EBAY_EXTRA_SMALL }],
  itemLocation: { country: "US" },
  seller: { username: "testuser_sandbox", feedbackPercentage: "98.5", feedbackScore: 120 },
  shippingOptions: [{ shippingCost: { value: "0.00", currency: "USD" }, shippingCostType: "FIXED" }],
  buyingOptions: ["FIXED_PRICE"],
};

const withoutImage: EbayItemSummary = {
  itemId: "v1|110589983218|0",
  title: "Listing with no picture",
  price: { value: "10.00", currency: "USD" },
};

const [normalized, noImage] = normalizeSearchResults([withImage, withoutImage]);

check(
  "product.image is the real eBay image URL, not the placeholder",
  normalized.image === EBAY_IMAGE && !normalized.image.includes("unsplash"),
  `image: ${normalized.image}`,
);

check(
  "image host is i.ebayimg.com (must be whitelisted in next.config.ts)",
  new URL(normalized.image).hostname === "i.ebayimg.com",
  `hostname: ${new URL(normalized.image).hostname}`,
);

check(
  "additional images are upscaled to full size, primary first, no duplicates " +
    "(the thumbnail collapses into the primary since upscaling makes them identical — see the dedicated upscale tests below)",
  JSON.stringify(normalized.images) === JSON.stringify([EBAY_IMAGE, EBAY_EXTRA]),
  `images: ${JSON.stringify(normalized.images)}`,
);

check(
  "thumbnailImages alone is enough when image is absent, and gets upscaled too",
  pickImages({ itemId: "x", title: "t", thumbnailImages: [{ imageUrl: EBAY_THUMB }] }).image === EBAY_IMAGE,
  `image: ${pickImages({ itemId: "x", title: "t", thumbnailImages: [{ imageUrl: EBAY_THUMB }] }).image}`,
);

check(
  "falls back to the existing placeholder when eBay returns no image",
  noImage.image.includes("images.unsplash.com"),
  `image: ${noImage.image}`,
);

// upscaleEbayImageUrl — the fix behind why feed/look cards were visibly
// lower quality than the product detail page for the exact same photo:
// item_summary/search commonly returns a small s-lNNN size for the
// same image the single-item lookup returns at s-l1600.

check(
  "a small eBay CDN size token is upgraded to s-l1600",
  upscaleEbayImageUrl(EBAY_THUMB) === EBAY_IMAGE,
  `upscaled: ${upscaleEbayImageUrl(EBAY_THUMB)}`,
);

check(
  "an already-max-size eBay URL is left unchanged (idempotent)",
  upscaleEbayImageUrl(EBAY_IMAGE) === EBAY_IMAGE,
  `upscaled: ${upscaleEbayImageUrl(EBAY_IMAGE)}`,
);

const S3_URL =
  "https://s3.us-east-1.amazonaws.com/swapproductionbucket/__sized__/public/images/ef46c4a2-9c99-41ce-b72b-c970bd9ae669-upscale_15k-1500x1500-70.jpg";
check(
  "a non-eBay host (e.g. a seller's own S3 bucket) is left completely unchanged",
  upscaleEbayImageUrl(S3_URL) === S3_URL,
  `upscaled: ${upscaleEbayImageUrl(S3_URL)}`,
);

check(
  "the Unsplash placeholder is left unchanged",
  upscaleEbayImageUrl(PLACEHOLDER_IMAGE_FOR_TEST) === PLACEHOLDER_IMAGE_FOR_TEST,
  `upscaled: ${upscaleEbayImageUrl(PLACEHOLDER_IMAGE_FOR_TEST)}`,
);

check(
  "a malformed URL is returned as-is rather than throwing",
  upscaleEbayImageUrl("not a url") === "not a url",
  `upscaled: ${upscaleEbayImageUrl("not a url")}`,
);

console.log(`\n${failures === 0 ? "All image checks passed." : `${failures} check(s) FAILED.`}`);
process.exit(failures === 0 ? 0 : 1);
