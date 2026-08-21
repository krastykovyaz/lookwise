// Product data model.
//
// Shaped so a normalized eBay Browse API item can be dropped in later
// without changing any UI component. Nothing in /components or /app
// should ever see raw eBay JSON — only this shape.

export type BuyingOption = "FIXED_PRICE" | "AUCTION" | "BEST_OFFER";

// Section 6 of the availability spec. Only ever populated when a
// Product comes from OUR cache (see dbProductToClientProduct) — a
// freshly-fetched live eBay product has no need for this, since
// fetching it successfully already proves it's available. Left
// undefined (not defaulted to "AVAILABLE") for live fetches so
// ProductCard's badge logic only ever activates for cache-derived,
// known-unavailable products, never accidentally for a live one.
export type AvailabilityStatus = "AVAILABLE" | "SOLD" | "ENDED" | "UNAVAILABLE";

export interface ProductSeller {
  username: string;
  feedbackScore: number | null;
  feedbackPercentage: number | null;
}

export interface ProductShipping {
  cost: number | null;
  currency: string | null;
  service: string | null;
  estimatedDelivery: string | null;
  shipsTo: string | null;
}

export interface Product {
  id: string;
  title: string;
  price: number;
  currency: string;
  image: string;
  images?: string[];
  condition: string;
  conditionId: string | null;
  brand: string | null;
  color: string | null;
  category: string | null;
  seller: ProductSeller | null;
  location: string | null;
  shipping: ProductShipping | null;
  returnPolicy: string | null;
  availability: string | null;
  buyingOptions: BuyingOption[];
  itemWebUrl: string | null;
  dealScore: number | null;
  // Optional, cache-only lifecycle fields — see AvailabilityStatus's
  // comment. unavailableAt is an ISO string (not a Date) to match how
  // the rest of this snapshot-friendly type represents everything
  // else that crosses a client/server JSON boundary.
  availabilityStatus?: AvailabilityStatus;
  unavailableAt?: string | null;
}

// A saved reference — kept minimal on purpose since there's no
// persistence layer yet (see /lib/mock and SaveButton).
export interface SavedProductRef {
  productId: string;
  savedAt: string;
}
