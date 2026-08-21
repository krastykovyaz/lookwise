import "server-only";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import type { PreferenceEvent } from "@/types/events";
import type { Product } from "@/types/product";
import type { GeneratedLook } from "@/types/style";
import { upsertProduct } from "@/lib/db/repositories/product";
import { createLook, type LookComponentInput } from "@/lib/db/repositories/look";
import { loadProductsByRowId, loadLooksByRowId } from "@/lib/db/repositories/reconstruct";
import { refreshStaleAvailability } from "@/lib/products/availability";

const RECENTLY_VIEWED_LIMIT_DEFAULT = 10;
const RECENTLY_VIEWED_LIMIT_MAX = 10;
// Section 9 of the availability spec: an unavailable item may keep
// showing a status badge for up to this long, but after it, it drops
// out of the ACTIVE Overview feed specifically — not out of Recently
// Viewed's own storage (see listRecentlyViewed's filter below) or
// Saved (unaffected — see that section's "prefer active/inactive
// visibility state over physical deletion").
const OVERVIEW_UNAVAILABLE_VISIBILITY_DAYS = 7;

// ---- Viewed products ---------------------------------------------------

/** Caches the product (see upsertProduct) so it stays reconstructable
 *  even once eBay's own listing is gone, then records the view. The
 *  cache write and the activity row are two inserts, not a
 *  transaction — a cache-write failure here would be a genuine bug
 *  worth surfacing (not swallowed), and the activity row is the part
 *  that must never silently fail per section: "actual user opens only". */
export async function recordViewedProduct(userId: string, product: Product, provider = "ebay") {
  await upsertProduct(provider, product);
  const now = new Date();
  await db
    .insert(schema.viewedProducts)
    .values({ userId, productId: product.id, provider, viewedAt: now })
    .onConflictDoUpdate({
      target: [schema.viewedProducts.userId, schema.viewedProducts.productId],
      set: { viewedAt: now, provider },
    });
  const stale = await db
    .select({ id: schema.viewedProducts.id })
    .from(schema.viewedProducts)
    .where(eq(schema.viewedProducts.userId, userId))
    .orderBy(desc(schema.viewedProducts.viewedAt))
    .limit(100);
  if (stale.length > 10) {
    await db.delete(schema.viewedProducts).where(
      inArray(schema.viewedProducts.id, stale.slice(10).map((row) => row.id)),
    );
  }
}

export interface ViewedProductEntry {
  id: string;
  viewedAt: Date;
  product: Product;
}

export async function listViewedProducts(userId: string, limit = 200): Promise<ViewedProductEntry[]> {
  const rows = await db
    .select()
    .from(schema.viewedProducts)
    .where(eq(schema.viewedProducts.userId, userId))
    .orderBy(desc(schema.viewedProducts.viewedAt))
    .limit(limit);
  return attachProducts(rows, (r) => r.provider, (r) => r.productId, (r, product) => ({
    id: r.id,
    viewedAt: r.viewedAt,
    product,
  }));
}

// ---- Saved products ------------------------------------------------------

export async function saveProduct(userId: string, product: Product, provider = "ebay") {
  await upsertProduct(provider, product);
  await db
    .insert(schema.savedProducts)
    .values({ userId, productId: product.id })
    .onConflictDoNothing({ target: [schema.savedProducts.userId, schema.savedProducts.productId] });
}

export async function unsaveProduct(userId: string, productId: string) {
  await db
    .delete(schema.savedProducts)
    .where(and(eq(schema.savedProducts.userId, userId), eq(schema.savedProducts.productId, productId)));
}

export interface SavedProductEntry {
  id: string;
  createdAt: Date;
  product: Product;
}

export async function listSavedProducts(userId: string): Promise<SavedProductEntry[]> {
  const rows = await db.select().from(schema.savedProducts).where(eq(schema.savedProducts.userId, userId));
  return attachProducts(rows, () => "ebay", (r) => r.productId, (r, product) => ({
    id: r.id,
    createdAt: r.createdAt,
    product,
  }));
}

/** Shared "row references a cached product by providerItemId -> attach
 *  the reconstructed Product" step used by both viewed and saved
 *  products above — one batched product lookup regardless of list
 *  size, not N+1 queries. Rows whose product was never cached (should
 *  only happen for pre-existing rows from before this cache existed)
 *  are dropped rather than shown with fabricated data. */
async function attachProducts<Row, Out>(
  rows: Row[],
  providerOf: (row: Row) => string,
  productIdOf: (row: Row) => string,
  build: (row: Row, product: Product) => Out,
): Promise<Out[]> {
  if (rows.length === 0) return [];
  const providerItemIds = [...new Set(rows.map(productIdOf))];
  const productRows =
    providerItemIds.length === 0
      ? []
      : await db.select().from(schema.products).where(inArray(schema.products.providerItemId, providerItemIds));
  // Best-effort, TTL-bounded — see refreshStaleAvailability's own
  // comment for why this lives here specifically (Overview/Saved)
  // rather than in the shared row->Product reconstruction helpers
  // that the public share pages also use. Never let an eBay hiccup
  // here break the list itself.
  await refreshStaleAvailability(productRows).catch((err) => {
    console.error("[attachProducts] availability refresh failed:", err);
  });
  const productRowIds = productRows.map((p) => p.id);
  const productsByRowId = await loadProductsByRowId(productRowIds);
  const productByProviderItemId = new Map<string, Product>();
  for (const row of productRows) {
    const client = productsByRowId.get(row.id);
    if (client) productByProviderItemId.set(row.providerItemId, client);
  }
  const out: Out[] = [];
  for (const row of rows) {
    const product = productByProviderItemId.get(productIdOf(row));
    if (product) out.push(build(row, product));
  }
  return out;
}

// ---- Saved looks -----------------------------------------------------

/** `lookId` stays the client's own key for its save/unsave toggle
 *  (unchanged — see lib/look/savedLooks.tsx). `look` is the full
 *  payload the client already has in memory at save time; it gets
 *  snapshotted via createLook() into permanent looks/lookProducts rows
 *  so the Saved page can always reconstruct it later, independent of
 *  whatever Explore session/pool originally produced it (section 3). */
export async function saveLook(userId: string, lookId: string, look: LookSnapshotInput, provider = "ebay") {
  const snapshot = await createLook({
    userId,
    title: look.title,
    description: look.description ?? null,
    provider,
    components: look.components,
  });
  await db
    .insert(schema.savedLooks)
    .values({ userId, lookId, snapshotLookId: snapshot.id })
    .onConflictDoNothing({ target: [schema.savedLooks.userId, schema.savedLooks.lookId] });
}

export async function unsaveLook(userId: string, lookId: string) {
  await db
    .delete(schema.savedLooks)
    .where(and(eq(schema.savedLooks.userId, userId), eq(schema.savedLooks.lookId, lookId)));
}

export interface SavedLookEntryRow {
  id: string;
  lookId: string;
  createdAt: Date;
  look: GeneratedLook;
}

export async function listSavedLooks(userId: string): Promise<SavedLookEntryRow[]> {
  const rows = await db.select().from(schema.savedLooks).where(eq(schema.savedLooks.userId, userId));
  return attachLooks(rows, (r) => r.snapshotLookId, (r, look) => ({
    id: r.id,
    lookId: r.lookId,
    createdAt: r.createdAt,
    look,
  }));
}

// ---- Recently-viewed looks --------------------------------------------

export async function recordViewedLook(userId: string, lookId: string, look: LookSnapshotInput, provider = "ebay") {
  const snapshot = await createLook({
    userId,
    title: look.title,
    description: look.description ?? null,
    provider,
    components: look.components,
  });
  const now = new Date();
  await db
    .insert(schema.viewedLooks)
    .values({ userId, lookId, snapshotLookId: snapshot.id, viewedAt: now })
    .onConflictDoUpdate({
      target: [schema.viewedLooks.userId, schema.viewedLooks.lookId],
      set: { viewedAt: now, snapshotLookId: snapshot.id },
    });
  const stale = await db
    .select({ id: schema.viewedLooks.id })
    .from(schema.viewedLooks)
    .where(eq(schema.viewedLooks.userId, userId))
    .orderBy(desc(schema.viewedLooks.viewedAt))
    .limit(100);
  if (stale.length > 10) {
    await db.delete(schema.viewedLooks).where(
      inArray(schema.viewedLooks.id, stale.slice(10).map((row) => row.id)),
    );
  }
}

export interface ViewedLookEntryRow {
  id: string;
  lookId: string;
  viewedAt: Date;
  look: GeneratedLook;
}

export async function listViewedLooks(userId: string, limit = 200): Promise<ViewedLookEntryRow[]> {
  const rows = await db
    .select()
    .from(schema.viewedLooks)
    .where(eq(schema.viewedLooks.userId, userId))
    .orderBy(desc(schema.viewedLooks.viewedAt))
    .limit(limit);
  return attachLooks(rows, (r) => r.snapshotLookId, (r, look) => ({
    id: r.id,
    lookId: r.lookId,
    viewedAt: r.viewedAt,
    look,
  }));
}

/** Combined, chronological Recently Viewed (section 4: "show recently
 *  viewed products and looks together in ONE list ... newest first"),
 *  server-backed for an authenticated user. Fetches each source at the
 *  same cap and merges/sorts in memory rather than a SQL UNION —
 *  simpler, and portable to the eventual Postgres move (see this
 *  file's dialect note) without rewriting a cross-table union query. */
export type RecentlyViewedEntry =
  | { type: "product"; id: string; timestamp: Date; product: Product }
  | { type: "look"; id: string; lookId: string; timestamp: Date; look: GeneratedLook };

export async function listRecentlyViewed(
  userId: string,
  limit = RECENTLY_VIEWED_LIMIT_DEFAULT,
): Promise<RecentlyViewedEntry[]> {
  const cappedLimit = Math.min(limit, RECENTLY_VIEWED_LIMIT_MAX);
  const [products, looks] = await Promise.all([
    listViewedProducts(userId, cappedLimit),
    listViewedLooks(userId, cappedLimit),
  ]);
  // Section 9: drop items unavailable for 7+ days from the ACTIVE
  // Overview feed specifically. The underlying viewed_product row (and
  // everything listViewedProducts itself returns) is untouched — this
  // filter only affects what this Overview-facing function hands
  // back, per that section's "do not remove Recently Viewed entries
  // merely because Overview stopped showing the item". A product may
  // end up short of `limit` after this; that's expected, not a bug —
  // there's no attempt to backfill to keep the count exactly 10.
  const activeProducts = products.filter((p) => !isLongUnavailable(p.product));
  const merged: RecentlyViewedEntry[] = [
    ...activeProducts.map((p): RecentlyViewedEntry => ({ type: "product", id: p.id, timestamp: p.viewedAt, product: p.product })),
    ...looks.map((l): RecentlyViewedEntry => ({ type: "look", id: l.id, lookId: l.lookId, timestamp: l.viewedAt, look: l.look })),
  ];
  merged.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  return merged.slice(0, cappedLimit);
}

function isLongUnavailable(product: Product): boolean {
  if (product.availabilityStatus === "AVAILABLE" || product.availabilityStatus == null) return false;
  if (!product.unavailableAt) return false;
  const unavailableSinceMs = new Date(product.unavailableAt).getTime();
  if (Number.isNaN(unavailableSinceMs)) return false;
  const days = (Date.now() - unavailableSinceMs) / (24 * 60 * 60 * 1000);
  return days >= OVERVIEW_UNAVAILABLE_VISIBILITY_DAYS;
}

export interface LookSnapshotInput {
  title: string;
  description?: string | null;
  components: LookComponentInput[];
}

/** Shared "row references a permanent looks snapshot -> attach the
 *  reconstructed GeneratedLook" step used by both saved and viewed
 *  looks above. Rows with no snapshot (null snapshotLookId — legacy
 *  pre-migration rows) are dropped rather than shown broken. */
async function attachLooks<Row, Out>(
  rows: Row[],
  snapshotIdOf: (row: Row) => string | null,
  build: (row: Row, look: GeneratedLook) => Out,
): Promise<Out[]> {
  if (rows.length === 0) return [];
  const snapshotIds = [...new Set(rows.map(snapshotIdOf).filter((id): id is string => Boolean(id)))];
  const looksByRowId = await loadLooksByRowId(snapshotIds);
  const out: Out[] = [];
  for (const row of rows) {
    const snapshotId = snapshotIdOf(row);
    const look = snapshotId ? looksByRowId.get(snapshotId) : undefined;
    if (look) out.push(build(row, look));
  }
  return out;
}

// ---- Like/dislike signals -----------------------------------------------
//
// Product-scoped signals (productId set) are current state, enforced by
// preference_signal_user_product_uq (schema/domain.ts) — at most one
// live row per (userId, productId). The three functions below are the
// only way product signals are written; they upsert/delete instead of
// blindly inserting, so repeated clicks or a like<->dislike change
// never leave more than one row behind.
//
// Look-scoped signals (lookId set, productId null) are untouched by
// that constraint and keep the original insert-only log behavior via
// recordPreferenceSignal further down — this feature doesn't touch
// that path.

export type ProductSignalType = "like" | "dislike";

/** Sets the user's current signal for a product. If the same
 *  signalType is already active, this is a no-op on content (still
 *  idempotent — no duplicate row, no error) so a double-click from a
 *  slow network retry can't create a second row. Returns the
 *  resulting row. */
export async function upsertProductSignal(userId: string, productId: string, signalType: ProductSignalType) {
  const now = new Date();
  await db
    .insert(schema.preferenceSignals)
    .values({ userId, productId, signalType, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: [schema.preferenceSignals.userId, schema.preferenceSignals.productId],
      // Must match the partial unique index's WHERE clause exactly
      // (schema/domain.ts's preference_signal_user_product_uq) — SQLite
      // requires the ON CONFLICT target to restate a partial index's
      // condition, it won't infer it.
      targetWhere: isNotNull(schema.preferenceSignals.productId),
      set: { signalType, updatedAt: now },
    });
  return getUserProductSignal(userId, productId);
}

/** Clears the user's signal for a product entirely (used when the
 *  currently-active button is clicked again — toggle off back to
 *  neutral, section 5 of the feedback-buttons task). */
export async function removeProductSignal(userId: string, productId: string) {
  await db
    .delete(schema.preferenceSignals)
    .where(
      and(
        eq(schema.preferenceSignals.userId, userId),
        eq(schema.preferenceSignals.productId, productId),
      ),
    );
}

export async function getUserProductSignal(userId: string, productId: string): Promise<ProductSignalType | null> {
  const [row] = await db
    .select({ signalType: schema.preferenceSignals.signalType })
    .from(schema.preferenceSignals)
    .where(
      and(
        eq(schema.preferenceSignals.userId, userId),
        eq(schema.preferenceSignals.productId, productId),
      ),
    );
  return (row?.signalType as ProductSignalType | undefined) ?? null;
}

/** Batch restore for a page of products (section: "do NOT make one API
 *  request per product"). Drizzle's `inArray` keeps this a single
 *  query regardless of how many ids are requested. */
export async function getUserProductSignals(
  userId: string,
  productIds: string[],
): Promise<Record<string, ProductSignalType>> {
  if (productIds.length === 0) return {};
  const rows = await db
    .select({ productId: schema.preferenceSignals.productId, signalType: schema.preferenceSignals.signalType })
    .from(schema.preferenceSignals)
    .where(and(eq(schema.preferenceSignals.userId, userId), inArray(schema.preferenceSignals.productId, productIds)));
  const result: Record<string, ProductSignalType> = {};
  for (const row of rows) {
    if (row.productId) result[row.productId] = row.signalType as ProductSignalType;
  }
  return result;
}

export async function recordPreferenceSignal(
  userId: string,
  input: { productId?: string | null; lookId?: string | null; signalType: "like" | "dislike" },
) {
  await db.insert(schema.preferenceSignals).values({
    userId,
    productId: input.productId ?? null,
    lookId: input.lookId ?? null,
    signalType: input.signalType,
  });
}

export async function listPreferenceSignals(userId: string) {
  return db.select().from(schema.preferenceSignals).where(eq(schema.preferenceSignals.userId, userId));
}

// ---- Events ---------------------------------------------------------------

export async function recordEvent(userId: string, event: Omit<PreferenceEvent, "id">) {
  await db.insert(schema.events).values({
    userId,
    type: event.type,
    productId: event.productId ?? null,
    lookId: event.lookId ?? null,
    category: event.category ?? null,
    brand: event.brand ?? null,
    price: event.price ?? null,
    source: event.source ?? null,
    metadata: event.metadata ?? null,
    timestamp: new Date(event.timestamp),
  });
}

export async function listEvents(userId: string, limit = 500) {
  return db
    .select()
    .from(schema.events)
    .where(eq(schema.events.userId, userId))
    .orderBy(desc(schema.events.timestamp))
    .limit(limit);
}
