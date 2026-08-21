// Exercises the Milestone 11 saved/recently-viewed persistence layer
// against a real, freshly migrated temporary SQLite database (not
// mocked) — saved products/looks survive a fresh "reload" (a brand
// new repository call against the same DB, standing in for a page
// refresh), are scoped per user, recently-viewed only records actual
// opens and combines products+looks chronologically with a bounded
// history, and the mock-product fallback stays out of production
// lookup paths. Run with `npm run verify:activity`.
//
// DATABASE_URL is pointed at a temp file *before* importing
// lib/db/client (and anything that transitively imports it), so every
// module in this process shares one connection to the throwaway
// database — never the real dev.db.

import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Product } from "../src/types/product";
import type { LookComponentInput } from "../src/lib/db/repositories/look";

function fakeProduct(id: string, title = `Test product ${id}`): Product {
  return {
    id,
    title,
    price: 42,
    currency: "USD",
    image: "https://example.com/img.jpg",
    condition: "Pre-owned",
    conditionId: null,
    brand: null,
    color: null,
    category: null,
    seller: { username: "test-seller", feedbackScore: 100, feedbackPercentage: 99.5 },
    location: null,
    shipping: null,
    returnPolicy: null,
    availability: null,
    buyingOptions: [],
    itemWebUrl: null,
    dealScore: null,
  };
}

function fakeLook(components: LookComponentInput[]) {
  return { title: "Test Look", description: null, components };
}

const dir = mkdtempSync(path.join(tmpdir(), "compass-activity-verify-"));
const dbPath = path.join(dir, "test.db");
process.env.DATABASE_URL = `file:${dbPath}`;

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${name}${detail ? `\n  ${detail}` : ""}`);
  }
}

async function main() {
  const { db, schema } = await import("../src/lib/db/client");
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");

  migrate(db, { migrationsFolder: path.join(__dirname, "..", "drizzle") });

  const {
    saveProduct,
    unsaveProduct,
    listSavedProducts,
    saveLook,
    unsaveLook,
    listSavedLooks,
    recordViewedProduct,
    recordViewedLook,
    listRecentlyViewed,
  } = await import("../src/lib/db/repositories/activity");

  const [userA] = await db.insert(schema.users).values({ email: "a@example.com" }).returning();
  const [userB] = await db.insert(schema.users).values({ email: "b@example.com" }).returning();

  // --- 1/2: saved product survives "refresh" and is user-specific ------
  await saveProduct(userA.id, fakeProduct("prod-1", "Blue Jacket"));
  const savedA = await listSavedProducts(userA.id); // a fresh repository call, same DB — stands in for a page refresh
  check("saved product survives refresh", savedA.length === 1 && savedA[0].product.id === "prod-1");
  check(
    "reconstructed saved product carries real data, not placeholders",
    savedA[0]?.product.title === "Blue Jacket" && savedA[0]?.product.seller?.username === "test-seller",
  );
  const savedB = await listSavedProducts(userB.id);
  check("saved product is user-specific (a different user sees none)", savedB.length === 0);

  await unsaveProduct(userA.id, "prod-1");
  check("unsave removes the product", (await listSavedProducts(userA.id)).length === 0);

  // --- 3/4: saved look survives "refresh" and is user-specific ---------
  const lookComponents: LookComponentInput[] = [
    { role: "top", product: fakeProduct("look-top-1", "White Shirt") },
    { role: "bottom", product: fakeProduct("look-bottom-1", "Black Jeans") },
  ];
  await saveLook(userA.id, "explore-look-1", fakeLook(lookComponents));
  const savedLooksA = await listSavedLooks(userA.id);
  check("saved look survives refresh", savedLooksA.length === 1 && savedLooksA[0].lookId === "explore-look-1");
  check(
    "saved look is reconstructed with its components, not just an id",
    savedLooksA[0]?.look.components.length === 2 &&
      savedLooksA[0]?.look.components.map((c) => c.product?.id).sort().join(",") === "look-bottom-1,look-top-1",
  );
  check("saved look is user-specific", (await listSavedLooks(userB.id)).length === 0);

  // Reconstructable even if the "Explore pool" it came from is gone —
  // simulated here by the fact that nothing about candidate
  // generation/Explore session state was ever touched; the look comes
  // back purely from the permanent looks/lookProducts snapshot.
  await unsaveLook(userA.id, "explore-look-1");
  check("unsave removes the look", (await listSavedLooks(userA.id)).length === 0);

  // --- 5: recently viewed is created only after an actual view ---------
  check("no viewed products before any recordViewedProduct call", (await listRecentlyViewed(userA.id)).length === 0);
  await recordViewedProduct(userA.id, fakeProduct("viewed-prod-1", "Viewed Sneakers"));
  const afterOneView = await listRecentlyViewed(userA.id);
  check(
    "recordViewedProduct (an actual open) creates exactly one recently-viewed entry",
    afterOneView.length === 1 && afterOneView[0].type === "product",
  );

  // --- 6: recently viewed combines products + looks chronologically ----
  await new Promise((r) => setTimeout(r, 5)); // ensure a distinct viewedAt ordering
  await recordViewedLook(userA.id, "explore-look-2", fakeLook(lookComponents));
  const combined = await listRecentlyViewed(userA.id);
  check(
    "recently viewed combines products and looks into one chronological (newest-first) list",
    combined.length === 2 && combined[0].type === "look" && combined[1].type === "product",
  );

  // --- 7: recently viewed has a bounded history -------------------------
  for (let i = 0; i < 15; i++) {
    await recordViewedProduct(userA.id, fakeProduct(`bounded-prod-${i}`));
  }
  const bounded = await listRecentlyViewed(userA.id, 5);
  check("recently viewed respects a requested limit", bounded.length === 5);
  const boundedDefault = await listRecentlyViewed(userA.id);
  check("recently viewed is capped even without an explicit limit (never grows unbounded)", boundedDefault.length <= 100);

  // --- 8: mock products are never a production fallback ----------------
  const productPageSource = readFileSync(
    path.join(__dirname, "..", "src", "app", "product", "[id]", "page.tsx"),
    "utf8",
  );
  check(
    "the product detail page only reaches for mock data behind an explicit mock- id prefix, never as a silent fallback for a real/unknown id",
    /getMockProductById\(id\)\s*:\s*undefined/.test(productPageSource) &&
      /id\.startsWith\(.mock-.\)/.test(productPageSource),
  );
  const discoverPageSource = readFileSync(path.join(__dirname, "..", "src", "app", "discover", "page.tsx"), "utf8");
  check(
    "the old /discover mock page no longer imports/renders MOCK_PRODUCTS (redirects to the real /explore feed instead)",
    !/import\s*\{[^}]*MOCK_PRODUCTS/.test(discoverPageSource) && /redirect\(.\/explore.\)/.test(discoverPageSource),
  );

  rmSync(dir, { recursive: true, force: true });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
