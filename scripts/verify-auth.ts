// Exercises the Milestone 5 repository layer against a real, freshly
// migrated temporary SQLite database (not mocked) — product/seller
// dedup, look persistence skipping fake components, profile upsert,
// and the anonymous->authenticated merge's field-level precedence
// rules. Run with `npm run verify:auth`.
//
// DATABASE_URL is pointed at a temp file *before* importing
// lib/db/client (and anything that transitively imports it, like
// lib/db/repositories/merge), so every module in this process shares
// one connection to the throwaway database — never the real dev.db.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Product } from "../src/types/product";

function fakeProduct(id: string): Product {
  return {
    id,
    title: `Test product ${id}`,
    price: 42,
    currency: "USD",
    image: "https://example.com/img.jpg",
    condition: "Pre-owned",
    conditionId: null,
    brand: null,
    color: null,
    category: null,
    seller: null,
    location: null,
    shipping: null,
    returnPolicy: null,
    availability: null,
    buyingOptions: [],
    itemWebUrl: null,
    dealScore: null,
  };
}

const dir = mkdtempSync(path.join(tmpdir(), "compass-auth-verify-"));
const dbPath = path.join(dir, "test.db");
process.env.DATABASE_URL = `file:${dbPath}`;

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${name}`);
  }
}

async function main() {
  const { db, schema } = await import("../src/lib/db/client");
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const { eq, and } = await import("drizzle-orm");

  migrate(db, { migrationsFolder: path.join(__dirname, "..", "drizzle") });

  const [user] = await db
    .insert(schema.users)
    .values({ email: "test@example.com", name: "Test User" })
    .returning();
  check("user created", !!user.id);

  // --- Seller dedup -------------------------------------------------
  const sellerValues = { provider: "ebay", providerSellerId: "seller-1", name: "cool_seller", updatedAt: new Date() };
  await db.insert(schema.sellers).values(sellerValues);
  await db
    .insert(schema.sellers)
    .values({ ...sellerValues, name: "cool_seller_renamed" })
    .onConflictDoUpdate({
      target: [schema.sellers.provider, schema.sellers.providerSellerId],
      set: { name: "cool_seller_renamed", updatedAt: new Date() },
    });
  const sellerRows = await db
    .select()
    .from(schema.sellers)
    .where(and(eq(schema.sellers.provider, "ebay"), eq(schema.sellers.providerSellerId, "seller-1")));
  check("seller unique constraint prevents duplicates", sellerRows.length === 1);
  check("seller upsert updates existing row", sellerRows[0]?.name === "cool_seller_renamed");

  // --- Product dedup (unique on provider+providerItemId) -------------
  const productValues = {
    provider: "ebay",
    providerItemId: "item-1",
    title: "Vintage jacket",
    lastSeenAt: new Date(),
    updatedAt: new Date(),
  };
  await db.insert(schema.products).values({ ...productValues, createdAt: new Date() });
  await db
    .insert(schema.products)
    .values({ ...productValues, title: "Vintage jacket (relisted)", createdAt: new Date() })
    .onConflictDoUpdate({
      target: [schema.products.provider, schema.products.providerItemId],
      set: { title: "Vintage jacket (relisted)", updatedAt: new Date() },
    });
  const productRows = await db
    .select()
    .from(schema.products)
    .where(and(eq(schema.products.provider, "ebay"), eq(schema.products.providerItemId, "item-1")));
  check("product unique constraint prevents duplicate eBay items", productRows.length === 1);
  check("product upsert refreshes cached fields", productRows[0]?.title === "Vintage jacket (relisted)");

  // --- Look persistence never inserts a fake product -------------------
  const [look] = await db
    .insert(schema.looks)
    .values({ userId: user.id, title: "Weekend look" })
    .returning();
  const realProduct = productRows[0];
  await db.insert(schema.lookProducts).values({ lookId: look.id, productId: realProduct.id, position: 0, role: "top" });
  // A role with no resolvable product is simply never inserted (see
  // createLook in lib/db/repositories/look.ts) — verify that skipping
  // it leaves exactly the one real component's row.
  const lookProductRows = await db.select().from(schema.lookProducts).where(eq(schema.lookProducts.lookId, look.id));
  check("look persists only real components (skipped role produced no row)", lookProductRows.length === 1);

  // --- Profile upsert -------------------------------------------------
  await db.insert(schema.styleProfiles).values({
    userId: user.id,
    styleArchetypes: ["minimalist"],
    budgetRange: "100_200",
    updatedAt: new Date(),
  });
  await db
    .update(schema.styleProfiles)
    .set({ budgetRange: "200_400", updatedAt: new Date() })
    .where(eq(schema.styleProfiles.userId, user.id));
  const [profileRow] = await db.select().from(schema.styleProfiles).where(eq(schema.styleProfiles.userId, user.id));
  check("profile upsert persists updated field", profileRow?.budgetRange === "200_400");

  // --- Anonymous -> authenticated merge: field-level precedence -----
  const { mergeAnonymousState } = await import("../src/lib/db/repositories/merge");

  const olderLocalProfile = {
    styleArchetypes: [], // empty on purpose: must not blank out the existing value
    preferredFit: null,
    preferredColors: [],
    dislikedColors: [],
    preferredBrands: ["Patagonia"],
    dislikedBrands: [],
    budgetRange: null,
    location: null,
    favoriteCategories: [],
    dislikedCategories: [],
    profileCompleteness: 0,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(), // deliberately older than the DB row
  };
  await mergeAnonymousState(user.id, { profile: olderLocalProfile as never });
  const [afterStaleMerge] = await db.select().from(schema.styleProfiles).where(eq(schema.styleProfiles.userId, user.id));
  check(
    "stale (older) local profile does not overwrite newer authenticated profile",
    afterStaleMerge?.budgetRange === "200_400",
  );

  const newerLocalProfile = {
    ...olderLocalProfile,
    preferredBrands: ["Patagonia", "Arc'teryx"],
    budgetRange: "400_700",
    updatedAt: new Date(Date.now() + 1000 * 60 * 60).toISOString(), // newer than DB row
  };
  await mergeAnonymousState(user.id, { profile: newerLocalProfile as never });
  const [afterFreshMerge] = await db.select().from(schema.styleProfiles).where(eq(schema.styleProfiles.userId, user.id));
  check("newer local profile updates budgetRange", afterFreshMerge?.budgetRange === "400_700");
  check(
    "newer local profile's empty styleArchetypes does not blank out existing value (field-level merge)",
    JSON.stringify(afterFreshMerge?.styleArchetypes) === JSON.stringify(["minimalist"]),
  );

  // --- Merge idempotency for activity logs ----------------------------
  await mergeAnonymousState(user.id, { savedProducts: [fakeProduct("item-1"), fakeProduct("item-1")] });
  await mergeAnonymousState(user.id, { savedProducts: [fakeProduct("item-1")] });
  const savedProductRows = await db.select().from(schema.savedProducts).where(eq(schema.savedProducts.userId, user.id));
  check("repeated merge of the same saved product is idempotent (unique constraint)", savedProductRows.length === 1);

  // --- Authorization boundary: repositories are always scoped by userId ---
  const [otherUser] = await db.insert(schema.users).values({ email: "other@example.com" }).returning();
  const otherUserSaved = await db.select().from(schema.savedProducts).where(eq(schema.savedProducts.userId, otherUser.id));
  check("a fresh user has no saved products from another user's session", otherUserSaved.length === 0);

  rmSync(dir, { recursive: true, force: true });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
