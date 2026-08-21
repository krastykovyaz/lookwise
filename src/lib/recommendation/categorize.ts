import "server-only";
import type { Product } from "@/types/product";
import type { ProductRoleBucket } from "@/types/explore";

// Keyword buckets, checked in order — a product only needs to match one
// keyword in its category path or title. Deliberately simple (this is
// look-assembly plumbing, not a taxonomy system): eBay Sandbox's test
// inventory skews heavily toward shoes, so "footwear" is checked first
// and most candidates are expected to land there or in "other".
const BUCKET_KEYWORDS: [ProductRoleBucket, RegExp][] = [
  ["footwear", /\b(sneaker|shoe|boot|sandal|loafer|trainer|cleat|slipper)/i],
  ["outerwear", /\b(jacket|coat|parka|blazer|cardigan|vest|windbreaker|puffer)/i],
  ["bottom", /\b(jean|pant|trouser|short|skirt|chino|legging|denim)/i],
  ["top", /\b(shirt|t-?shirt|tee|sweater|blouse|tank|polo|hoodie|jersey)/i],
  ["accessory", /\b(bag|belt|hat|cap|scarf|watch|sunglasses|wallet|jewelry|necklace)/i],
];

export function categorizeProduct(product: Product): ProductRoleBucket {
  const haystack = `${product.category ?? ""} ${product.title}`;
  for (const [bucket, pattern] of BUCKET_KEYWORDS) {
    if (pattern.test(haystack)) return bucket;
  }
  return "other";
}

// A rough seasonal/weather keyword to bias candidate-generation queries
// (section 16) without a separate weather system.
export function weatherKeyword(temperatureC: number | null, isRainy: boolean): string | null {
  if (isRainy) return "waterproof jacket";
  if (temperatureC == null) return null;
  if (temperatureC <= 5) return "warm jacket";
  if (temperatureC <= 14) return "light jacket";
  if (temperatureC >= 25) return "lightweight breathable";
  return null;
}
