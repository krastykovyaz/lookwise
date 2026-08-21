import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import type { Product } from "@/types/product";

export async function upsertSeller(provider: string, providerSellerId: string, name: string, rating?: number | null, feedbackCount?: number | null) {
  const now = new Date();
  await db
    .insert(schema.sellers)
    .values({ provider, providerSellerId, name, rating: rating ?? null, feedbackCount: feedbackCount ?? null, updatedAt: now })
    .onConflictDoUpdate({
      target: [schema.sellers.provider, schema.sellers.providerSellerId],
      set: { name, rating: rating ?? null, feedbackCount: feedbackCount ?? null, updatedAt: now },
    });
  const [row] = await db
    .select()
    .from(schema.sellers)
    .where(and(eq(schema.sellers.provider, provider), eq(schema.sellers.providerSellerId, providerSellerId)));
  return row ?? null;
}

/** Persists (or refreshes) the cache row for a real product actually
 *  encountered by the app. Never call this with a synthetic/placeholder
 *  item — see section 7's "no fake products" rule, enforced by callers
 *  in lib/look and lib/recommendation, not here. */
export async function upsertProduct(provider: string, product: Product) {
  const now = new Date();
  let sellerRowId: string | null = null;
  if (product.seller?.username) {
    const seller = await upsertSeller(provider, product.seller.username, product.seller.username, product.seller.feedbackPercentage, product.seller.feedbackScore);
    sellerRowId = seller?.id ?? null;
  }

  const values = {
    provider,
    providerItemId: product.id,
    title: product.title,
    brand: product.brand,
    category: product.category,
    gender: null as string | null,
    price: product.price,
    currency: product.currency,
    condition: product.condition,
    sellerId: sellerRowId,
    sellerName: product.seller?.username ?? null,
    imageUrl: product.image,
    productUrl: product.itemWebUrl,
    availability: product.availability,
    lastSeenAt: now,
    updatedAt: now,
  };

  await db
    .insert(schema.products)
    .values({ ...values, createdAt: now })
    .onConflictDoUpdate({ target: [schema.products.provider, schema.products.providerItemId], set: values });

  const [row] = await db
    .select()
    .from(schema.products)
    .where(and(eq(schema.products.provider, provider), eq(schema.products.providerItemId, product.id)));
  return row ?? null;
}

export async function getProductByProviderItemId(provider: string, providerItemId: string) {
  const [row] = await db
    .select()
    .from(schema.products)
    .where(and(eq(schema.products.provider, provider), eq(schema.products.providerItemId, providerItemId)));
  return row ?? null;
}
