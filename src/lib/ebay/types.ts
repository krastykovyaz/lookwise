// Raw eBay Browse API shapes. These mirror (a practical subset of)
// what the Sandbox actually returns, per the requests we manually
// verified. Nothing outside src/lib/ebay should import from this file
// — see normalize.ts for the boundary into the app's own Product type.

export interface EbayMoney {
  value: string;
  currency: string;
}

export interface EbayImage {
  imageUrl: string;
}

export interface EbaySeller {
  username?: string;
  feedbackPercentage?: string;
  feedbackScore?: number;
}

export interface EbayShippingOption {
  shippingCost?: EbayMoney;
  shippingCostType?: string;
  minEstimatedDeliveryDate?: string;
  maxEstimatedDeliveryDate?: string;
}

export interface EbayItemLocation {
  city?: string;
  country?: string;
}

export interface EbayReturnTerms {
  returnsAccepted?: boolean;
  returnPeriod?: { value?: number; unit?: string };
}

export interface EbayItemSummary {
  itemId: string;
  // Present on some Browse API responses alongside the (always
  // present) v1|...  itemId — used only as a de-dup fallback key
  // (see lib/ebay/index.ts's searchProducts).
  legacyItemId?: string;
  title: string;
  price?: EbayMoney;
  condition?: string;
  conditionId?: string;
  image?: EbayImage;
  // Both are optionally returned by item_summary/search and item/{id};
  // neither is guaranteed, so normalize.ts treats them as fallbacks.
  thumbnailImages?: EbayImage[];
  additionalImages?: EbayImage[];
  itemLocation?: EbayItemLocation;
  seller?: EbaySeller;
  shippingOptions?: EbayShippingOption[];
  buyingOptions?: string[];
  itemWebUrl?: string;
  listingMarketplaceId?: string;
}

export interface EbaySearchResponse {
  href?: string;
  total?: number;
  limit?: number;
  offset?: number;
  itemSummaries?: EbayItemSummary[];
  warnings?: { message: string }[];
}

// Full single-item response (from GET /buy/browse/v1/item/{itemId}) —
// a superset of the summary with a few extra detail fields.
export interface EbayItem extends EbayItemSummary {
  brand?: string;
  color?: string;
  categoryPath?: string;
  localizedAspects?: { name: string; value: string }[];
  estimatedAvailabilities?: { estimatedAvailableQuantity?: number }[];
  returnTerms?: EbayReturnTerms;
}

export interface EbayOAuthTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

export interface EbayApiErrorBody {
  errors?: {
    errorId?: number;
    message?: string;
    longMessage?: string;
  }[];
}
