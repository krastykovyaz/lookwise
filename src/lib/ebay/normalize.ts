import "server-only";
import type { Product } from "@/types/product";
import type { EbayItem, EbayItemSummary } from "@/lib/ebay/types";
import { computeDealScore } from "@/lib/ebay/dealScore";

const PLACEHOLDER_IMAGE =
  "https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=800&q=80";

function toNumber(value: string | undefined): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// eBay's CDN (i.ebayimg.com) serves whatever resolution is encoded in
// the `s-lNNN` path segment, independent of which endpoint the URL
// came from — item_summary/search commonly hands back a small
// thumbnail (e.g. s-l225 or s-l500) for the exact same photo the
// single-item lookup returns at s-l1600. Rather than the resolution a
// card gets depending on which endpoint happened to produce its URL
// (which is what caused feed/look cards to look visibly worse than
// the product detail page for the same photo), every extracted image
// is upgraded to the largest size eBay's CDN serves.
const EBAY_IMAGE_HOST_PATTERN = /(^|\.)ebayimg\.com$/i;
const EBAY_SIZE_TOKEN_PATTERN = /s-l\d+(?=\.(?:jpg|jpeg|png|webp)(?:$))/i;
const EBAY_MAX_SIZE_TOKEN = "s-l1600";

/**
 * Pure and exported so it's directly unit-testable — see
 * scripts/verify-images.ts. Only rewrites eBay-hosted URLs matching
 * the known `s-lNNN` sizing convention; anything else (the local
 * placeholder, a seller's own S3 bucket or third-party CDN — see the
 * s3.us-east-1.amazonaws.com case) is returned unchanged, since their
 * sizing conventions are unknown and blindly rewriting could break the
 * URL entirely.
 */
export function upscaleEbayImageUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (!EBAY_IMAGE_HOST_PATTERN.test(parsed.hostname)) return url;
  if (!EBAY_SIZE_TOKEN_PATTERN.test(parsed.pathname)) return url;
  parsed.pathname = parsed.pathname.replace(EBAY_SIZE_TOKEN_PATTERN, EBAY_MAX_SIZE_TOKEN);
  return parsed.toString();
}

/**
 * Image extraction. eBay only guarantees `image.imageUrl`; `thumbnailImages`
 * and `additionalImages` are returned for some listings only, so they're used
 * strictly as fallbacks / extras — no invented fields.
 * Returns the placeholder only when eBay gave us no usable URL at all.
 */
export function pickImages(item: EbayItemSummary): {
  image: string;
  images: string[];
} {
  const urls: string[] = [];
  const push = (url: string | undefined) => {
    if (typeof url !== "string" || !url.trim()) return;
    const upscaled = upscaleEbayImageUrl(url);
    if (!urls.includes(upscaled)) urls.push(upscaled);
  };

  push(item.image?.imageUrl);
  for (const img of item.additionalImages ?? []) push(img?.imageUrl);
  for (const img of item.thumbnailImages ?? []) push(img?.imageUrl);

  return {
    image: urls[0] ?? PLACEHOLDER_IMAGE,
    images: urls,
  };
}

function normalizeShared(item: EbayItemSummary) {
  const shippingOption = item.shippingOptions?.[0];
  const { image } = pickImages(item);
  return {
    id: item.itemId,
    title: item.title,
    price: toNumber(item.price?.value) ?? 0,
    currency: item.price?.currency ?? "USD",
    image,
    condition: item.condition ?? "Condition not specified",
    conditionId: item.conditionId ?? null,
    location: item.itemLocation?.country ?? item.itemLocation?.city ?? null,
    seller: item.seller
      ? {
          username: item.seller.username ?? "Unknown seller",
          feedbackScore: item.seller.feedbackScore ?? null,
          feedbackPercentage: toNumber(item.seller.feedbackPercentage),
        }
      : null,
    shipping: shippingOption
      ? {
          cost: toNumber(shippingOption.shippingCost?.value),
          currency: shippingOption.shippingCost?.currency ?? null,
          service: shippingOption.shippingCostType ?? null,
          estimatedDelivery: shippingOption.maxEstimatedDeliveryDate ?? null,
          shipsTo: null,
        }
      : null,
    buyingOptions: (item.buyingOptions ?? []).filter(
      (o): o is Product["buyingOptions"][number] =>
        o === "FIXED_PRICE" || o === "AUCTION" || o === "BEST_OFFER",
    ),
    itemWebUrl: item.itemWebUrl ?? null,
    listingMarketplaceId: item.listingMarketplaceId,
  };
}

/**
 * Normalizes a single search-result item. Deal Score needs the whole
 * result set's price range, so it's computed in normalizeSearchResults
 * and passed in here rather than derived per-item.
 */
export function normalizeItemSummary(
  item: EbayItemSummary,
  dealScore: number | null,
): Product {
  const shared = normalizeShared(item);
  const { images } = pickImages(item);
  return {
    ...shared,
    images: images.length > 1 ? images : undefined,
    brand: null,
    color: null,
    category: null,
    returnPolicy: null,
    availability: null,
    dealScore,
  };
}

export function normalizeSearchResults(items: EbayItemSummary[]): Product[] {
  const prices = items
    .map((i) => toNumber(i.price?.value))
    .filter((p): p is number => p != null);
  const priceGroupMin = prices.length > 0 ? Math.min(...prices) : null;
  const priceGroupMax = prices.length > 0 ? Math.max(...prices) : null;

  return items.map((item) => {
    const price = toNumber(item.price?.value);
    const feedbackPct = toNumber(item.seller?.feedbackPercentage);
    const dealScore = computeDealScore({
      price,
      priceGroupMin,
      priceGroupMax,
      conditionId: item.conditionId ?? null,
      sellerFeedbackPercentage: feedbackPct,
      hasShipping: Boolean(item.shippingOptions?.length),
    });
    return normalizeItemSummary(item, dealScore);
  });
}

export function normalizeItem(item: EbayItem): Product {
  const shared = normalizeShared(item);
  const feedbackPct = toNumber(item.seller?.feedbackPercentage);
  const dealScore = computeDealScore({
    price: toNumber(item.price?.value),
    priceGroupMin: null,
    priceGroupMax: null,
    conditionId: item.conditionId ?? null,
    sellerFeedbackPercentage: feedbackPct,
    hasShipping: Boolean(item.shippingOptions?.length),
  });

  return {
    ...shared,
    images: pickImages(item).images,
    brand: item.brand ?? null,
    color: item.color ?? null,
    category: item.categoryPath ?? null,
    returnPolicy: item.returnTerms?.returnsAccepted
      ? item.returnTerms.returnPeriod
        ? `${item.returnTerms.returnPeriod.value ?? ""} ${item.returnTerms.returnPeriod.unit ?? ""}`.trim()
        : "Returns accepted"
      : item.returnTerms?.returnsAccepted === false
        ? "No returns"
        : null,
    availability:
      item.estimatedAvailabilities?.[0]?.estimatedAvailableQuantity != null
        ? `${item.estimatedAvailabilities[0].estimatedAvailableQuantity} available`
        : null,
    dealScore,
  };
}
