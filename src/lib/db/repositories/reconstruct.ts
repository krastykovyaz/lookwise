import "server-only";
import { inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import type { AvailabilityStatus, Product } from "@/types/product";
import type { GeneratedLook, OutfitComponent } from "@/types/style";
import type { ProductSnapshotInput, LookSnapshotRequestInput } from "@/lib/schemas";
import type { LookComponentInput } from "@/lib/db/repositories/look";

/** Fills in the Product fields a client snapshot payload doesn't carry
 *  (see ProductSnapshotSchema's comment) with safe defaults, so the
 *  rest of the app (ProductCard, etc.) can treat a reconstructed
 *  product exactly like a live one. */
export function productSnapshotToProduct(input: ProductSnapshotInput): Product {
  return {
    id: input.id,
    title: input.title,
    price: input.price ?? 0,
    currency: input.currency ?? "USD",
    image: input.image ?? "",
    images: undefined,
    condition: input.condition ?? "",
    conditionId: null,
    brand: input.brand ?? null,
    color: null,
    category: input.category ?? null,
    seller: input.seller?.username
      ? {
          username: input.seller.username,
          feedbackScore: input.seller.feedbackScore ?? null,
          feedbackPercentage: input.seller.feedbackPercentage ?? null,
        }
      : null,
    location: null,
    shipping: null,
    returnPolicy: null,
    availability: input.availability ?? null,
    buyingOptions: [],
    itemWebUrl: input.itemWebUrl ?? null,
    dealScore: null,
  };
}

export function lookSnapshotToComponents(input: LookSnapshotRequestInput): LookComponentInput[] {
  return input.components.map((c) => ({
    role: c.role,
    product: c.product ? productSnapshotToProduct(c.product) : null,
  }));
}

// Turns a cached `product` row (+ its seller row, if any) back into the
// client-facing Product shape. This is a snapshot, not a live eBay
// fetch — fields the cache table doesn't carry (extra images, color,
// shipping detail, buying options, deal score...) come back as
// null/empty rather than being re-fetched, which is enough to render a
// ProductCard (title/price/image/condition/seller%) without depending
// on the item still being live on eBay or on any particular Explore
// session/pool still existing.
export function dbProductToClientProduct(
  row: typeof schema.products.$inferSelect,
  seller: typeof schema.sellers.$inferSelect | null,
): Product {
  return {
    id: row.providerItemId,
    title: row.title,
    price: row.price ?? 0,
    currency: row.currency ?? "USD",
    image: row.imageUrl ?? "",
    images: undefined,
    condition: row.condition ?? "",
    conditionId: null,
    brand: row.brand,
    color: null,
    category: row.category,
    seller: row.sellerName
      ? {
          username: row.sellerName,
          feedbackScore: seller?.feedbackCount ?? null,
          feedbackPercentage: seller?.rating ?? null,
        }
      : null,
    location: null,
    shipping: null,
    returnPolicy: null,
    availability: row.availability,
    buyingOptions: [],
    itemWebUrl: row.productUrl,
    dealScore: null,
    availabilityStatus: isAvailabilityStatus(row.availabilityStatus) ? row.availabilityStatus : "AVAILABLE",
    unavailableAt: row.unavailableAt ? row.unavailableAt.toISOString() : null,
  };
}

function isAvailabilityStatus(value: string | null | undefined): value is AvailabilityStatus {
  return value === "AVAILABLE" || value === "SOLD" || value === "ENDED" || value === "UNAVAILABLE";
}

/** Batch-loads and reconstructs full Product objects for a set of
 *  cached product row ids (schema.products.id, NOT providerItemId) —
 *  one round trip regardless of how many products are being
 *  reconstructed, rather than N+1 queries per list. */
export async function loadProductsByRowId(rowIds: string[]): Promise<Map<string, Product>> {
  const result = new Map<string, Product>();
  if (rowIds.length === 0) return result;

  const productRows = await db.select().from(schema.products).where(inArray(schema.products.id, rowIds));
  const sellerIds = productRows.map((p) => p.sellerId).filter((id): id is string => Boolean(id));
  const sellerRows = sellerIds.length
    ? await db.select().from(schema.sellers).where(inArray(schema.sellers.id, sellerIds))
    : [];
  const sellersById = new Map(sellerRows.map((s) => [s.id, s]));

  for (const row of productRows) {
    result.set(row.id, dbProductToClientProduct(row, row.sellerId ? (sellersById.get(row.sellerId) ?? null) : null));
  }
  return result;
}

/** Reconstructs full GeneratedLook objects (title + ordered, role-
 *  labeled components with their products) for a set of permanent
 *  `looks` row ids — the snapshot rows created by createLook() at
 *  save/view time (see lib/db/repositories/look.ts and this file's
 *  callers in activity.ts). One batched round trip for any number of
 *  looks. Looks with no persistable components (or a missing/deleted
 *  snapshot) still come back with an empty components array rather
 *  than being dropped, so a caller's list stays the same length as
 *  its input. */
export async function loadLooksByRowId(lookRowIds: string[]): Promise<Map<string, GeneratedLook>> {
  const result = new Map<string, GeneratedLook>();
  if (lookRowIds.length === 0) return result;

  const lookRows = await db.select().from(schema.looks).where(inArray(schema.looks.id, lookRowIds));
  const lookProductRows = await db
    .select()
    .from(schema.lookProducts)
    .where(inArray(schema.lookProducts.lookId, lookRowIds));
  const productsById = await loadProductsByRowId([...new Set(lookProductRows.map((lp) => lp.productId))]);

  const componentsByLookId = new Map<string, OutfitComponent[]>();
  for (const lp of [...lookProductRows].sort((a, b) => a.position - b.position)) {
    const product = productsById.get(lp.productId) ?? null;
    if (!product) continue; // never surface a component pointing at a product we can't reconstruct
    const list = componentsByLookId.get(lp.lookId) ?? [];
    list.push({ role: lp.role ?? "other", searchQuery: "", productId: product.id, product, alternatives: [] });
    componentsByLookId.set(lp.lookId, list);
  }

  for (const lookRow of lookRows) {
    const components = componentsByLookId.get(lookRow.id) ?? [];
    result.set(lookRow.id, {
      id: lookRow.id,
      title: lookRow.title,
      description: lookRow.description ?? undefined,
      createdAt: lookRow.createdAt.toISOString(),
      components,
      totalPrice: components.length
        ? components.reduce((sum, c) => sum + (c.product?.price ?? 0), 0)
        : null,
      currency: components.find((c) => c.product)?.product?.currency ?? null,
      styleNotes: undefined,
    });
  }
  return result;
}
