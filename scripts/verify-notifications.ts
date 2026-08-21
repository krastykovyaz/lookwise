// Exercises the Notifications MVP against a real, freshly migrated
// temporary SQLite database (not mocked, never the real dev.db) —
// creation triggers (item/Look unavailability, referral signup),
// duplicate-prevention via the dedupeKey partial unique index,
// cross-user isolation, read/read-all, and pagination. Run with
// `npm run verify:notifications`.
//
// DATABASE_URL is pointed at a temp file *before* importing
// lib/db/client (and anything that transitively imports it), so every
// module in this process shares one connection to the throwaway
// database — same pattern as verify-auth.ts.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "compass-notifications-verify-"));
const dbPath = path.join(dir, "test.db");
process.env.DATABASE_URL = `file:${dbPath}`;
// refreshStaleAvailability's real branch (fetchPublicProduct -> eBay)
// is exercised via lib/products/public.ts's fetchPublicProduct, which
// throws EbayConfigError without eBay creds. That's actually what this
// script wants: any thrown/failed live fetch is treated as "gone" by
// availability.ts, which is exactly the UNAVAILABLE transition being
// tested — no real network access required.

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
  const { eq } = await import("drizzle-orm");
  const { createLook } = await import("../src/lib/db/repositories/look");
  const { refreshStaleAvailability, runAvailabilitySweep } = await import("../src/lib/products/availability");
  const { createReferralIfAbsent } = await import("../src/lib/db/repositories/referral");
  const {
    createNotification,
    listNotifications,
    countUnreadNotifications,
    markNotificationRead,
    markAllNotificationsRead,
    getNotificationForUser,
  } = await import("../src/lib/db/repositories/notifications");

  migrate(db, { migrationsFolder: path.join(__dirname, "..", "drizzle") });

  const now = new Date();
  const [userA] = await db.insert(schema.users).values({ email: "a@example.com" }).returning();
  const [userB] = await db.insert(schema.users).values({ email: "b@example.com" }).returning();
  const [userC] = await db.insert(schema.users).values({ email: "c@example.com" }).returning();

  // --- Dedupe key: two identical events must produce exactly one row ---
  const first = await createNotification({
    userId: userA.id,
    type: "SYSTEM",
    title: "T",
    body: "B",
    dedupeKey: "dedupe-test-1",
  });
  const second = await createNotification({
    userId: userA.id,
    type: "SYSTEM",
    title: "T",
    body: "B (should not be inserted)",
    dedupeKey: "dedupe-test-1",
  });
  check("createNotification returns a row on first insert", !!first?.id);
  const dedupeRows = await db
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.userId, userA.id));
  check("duplicate dedupeKey inserts exactly one row", dedupeRows.length === 1);
  check("duplicate call did not overwrite the original title", dedupeRows[0]?.title === "T");
  void second;

  // A null dedupeKey (ad hoc SYSTEM notifications) must NOT be deduped
  // against other null-dedupeKey rows for the same user.
  await createNotification({ userId: userA.id, type: "SYSTEM", title: "S1", body: "b" });
  await createNotification({ userId: userA.id, type: "SYSTEM", title: "S2", body: "b" });
  const systemRows = await db
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.userId, userA.id));
  check("null dedupeKey notifications are never deduped against each other", systemRows.length === 3);

  // Clean slate for the trigger tests below.
  await db.delete(schema.notifications);

  // --- ITEM_UNAVAILABLE + LOOK_ITEM_UNAVAILABLE trigger -----------------
  const fakeItemId = "TEST-ITEM-1";
  const sevenHoursAgo = new Date(now.getTime() - 7 * 60 * 60 * 1000);
  const [productRow] = await db
    .insert(schema.products)
    .values({
      provider: "ebay",
      providerItemId: fakeItemId,
      title: "Test Product",
      price: 42,
      currency: "USD",
      availabilityStatus: "AVAILABLE",
      lastSeenAt: sevenHoursAgo,
      updatedAt: sevenHoursAgo,
      createdAt: sevenHoursAgo,
    })
    .returning();

  // User A favorited/saved it directly.
  await db.insert(schema.savedProducts).values({ userId: userA.id, productId: fakeItemId });

  // User B saved a Look containing it.
  const snapshot = await createLook({
    userId: userB.id,
    title: "Test Look",
    description: null,
    provider: "ebay",
    components: [
      {
        role: "top",
        product: {
          id: fakeItemId,
          title: "Test Product",
          price: 42,
          currency: "USD",
          image: "",
          condition: null,
          category: null,
          brand: null,
          availability: null,
          itemWebUrl: null,
          seller: null,
        } as never,
      },
    ],
  });
  await db.insert(schema.savedLooks).values({ userId: userB.id, lookId: "client-look-1", snapshotLookId: snapshot.id });

  // User C has no relationship to this item at all — must never be notified.
  check("baseline: no notifications exist yet", (await countUnreadNotifications(userA.id)) === 0);

  await refreshStaleAvailability([productRow]);

  check("favoriting user (A) got exactly 1 unread notification", (await countUnreadNotifications(userA.id)) === 1);
  check("Look-saving user (B) got exactly 1 unread notification", (await countUnreadNotifications(userB.id)) === 1);
  check("unrelated user (C) got no notification", (await countUnreadNotifications(userC.id)) === 0);

  const [notifA] = (await listNotifications(userA.id)).items;
  check("User A's notification is ITEM_UNAVAILABLE", notifA?.type === "ITEM_UNAVAILABLE");
  check("User A's notification links to the item", notifA?.entityType === "item" && notifA?.entityId === fakeItemId);

  const [notifB] = (await listNotifications(userB.id)).items;
  check("User B's notification is LOOK_ITEM_UNAVAILABLE", notifB?.type === "LOOK_ITEM_UNAVAILABLE");
  check("User B's notification links to the saved Look snapshot", notifB?.entityType === "look" && notifB?.entityId === snapshot.id);

  const [updatedProduct] = await db.select().from(schema.products).where(eq(schema.products.id, productRow.id));
  check("product actually transitioned to UNAVAILABLE", updatedProduct.availabilityStatus === "UNAVAILABLE");

  // --- Repeated check must NOT duplicate (acceptance test #14) ---------
  await db.update(schema.products).set({ lastSeenAt: sevenHoursAgo }).where(eq(schema.products.id, productRow.id));
  const [staleAgain] = await db.select().from(schema.products).where(eq(schema.products.id, productRow.id));
  await refreshStaleAvailability([staleAgain]);
  check("repeated availability check does not duplicate User A's notification", (await countUnreadNotifications(userA.id)) === 1);
  check("repeated availability check does not duplicate User B's notification", (await countUnreadNotifications(userB.id)) === 1);

  // --- Referral notification, once per relationship ----------------------
  check("referrer has no notifications yet", (await countUnreadNotifications(userC.id)) === 0);
  await createReferralIfAbsent({ referrerUserId: userC.id, referredUserId: userA.id, sourceType: "look", sourceId: snapshot.id });
  check("referrer got exactly 1 notification after a new referral", (await countUnreadNotifications(userC.id)) === 1);
  await createReferralIfAbsent({ referrerUserId: userC.id, referredUserId: userA.id, sourceType: "look", sourceId: snapshot.id });
  check("repeated referral call does not duplicate the notification", (await countUnreadNotifications(userC.id)) === 1);

  // --- Cross-user isolation at the repository layer -----------------------
  check("User B cannot fetch User A's notification via getNotificationForUser", (await getNotificationForUser(userB.id, notifA.id)) === null);
  const crossUserRead = await markNotificationRead(userB.id, notifA.id);
  check("User B marking User A's notification as read is a no-op (returns null)", crossUserRead === null);
  const [stillUnread] = await db.select().from(schema.notifications).where(eq(schema.notifications.id, notifA.id));
  check("User A's notification is still unread after User B's attempt", stillUnread.readAt === null);

  // --- Read / read-all ----------------------------------------------------
  const readRow = await markNotificationRead(userA.id, notifA.id);
  check("owner can mark their own notification read", readRow?.readAt != null);
  check("unread count drops after marking read", (await countUnreadNotifications(userA.id)) === 0);

  await createNotification({ userId: userA.id, type: "SYSTEM", title: "extra1", body: "b" });
  await createNotification({ userId: userA.id, type: "SYSTEM", title: "extra2", body: "b" });
  check("two more unread notifications exist", (await countUnreadNotifications(userA.id)) === 2);
  const markedCount = await markAllNotificationsRead(userA.id);
  check("markAllNotificationsRead reports the right count", markedCount === 2);
  check("mark-all-as-read zeroes the unread count", (await countUnreadNotifications(userA.id)) === 0);
  check("mark-all-as-read did not touch User B's unread notification", (await countUnreadNotifications(userB.id)) === 1);

  // --- Proactive availability sweep (background worker) -------------------
  // No page load, no reactive trigger — the sweep must find and check
  // stale items with an active relationship entirely on its own, and
  // must NEVER touch a stale item nobody has any relationship to.
  const sevenHoursAgo2 = new Date(Date.now() - 7 * 60 * 60 * 1000);
  const [userD] = await db.insert(schema.users).values({ email: "d@example.com" }).returning();

  const [ownDirect] = await db
    .insert(schema.products)
    .values({
      provider: "ebay",
      providerItemId: "SWEEP-DIRECT-1",
      title: "Sweep test: favorited item",
      availabilityStatus: "AVAILABLE",
      lastSeenAt: sevenHoursAgo2,
      updatedAt: sevenHoursAgo2,
      createdAt: sevenHoursAgo2,
    })
    .returning();
  await db.insert(schema.savedProducts).values({ userId: userD.id, productId: "SWEEP-DIRECT-1" });

  const [unrelated] = await db
    .insert(schema.products)
    .values({
      provider: "ebay",
      providerItemId: "SWEEP-UNRELATED-1",
      title: "Sweep test: nobody saved this",
      availabilityStatus: "AVAILABLE",
      lastSeenAt: sevenHoursAgo2,
      updatedAt: sevenHoursAgo2,
      createdAt: sevenHoursAgo2,
    })
    .returning();

  const [tooFresh] = await db
    .insert(schema.products)
    .values({
      provider: "ebay",
      providerItemId: "SWEEP-FRESH-1",
      title: "Sweep test: saved but checked recently",
      availabilityStatus: "AVAILABLE",
      lastSeenAt: new Date(), // well within the 6h TTL
      updatedAt: new Date(),
      createdAt: new Date(),
    })
    .returning();
  await db.insert(schema.savedProducts).values({ userId: userD.id, productId: "SWEEP-FRESH-1" });

  const sweepStats = await runAvailabilitySweep();
  check("sweep found and checked the favorited+stale item", sweepStats.candidatesChecked >= 1);

  const [afterOwnDirect] = await db.select().from(schema.products).where(eq(schema.products.id, ownDirect.id));
  check("sweep flipped the favorited stale item to UNAVAILABLE", afterOwnDirect.availabilityStatus === "UNAVAILABLE");
  check(
    "sweep created exactly one notification for the favoriting user",
    (await countUnreadNotifications(userD.id)) === 1,
  );

  const [afterUnrelated] = await db.select().from(schema.products).where(eq(schema.products.id, unrelated.id));
  check(
    "sweep NEVER touched the unrelated item (no relationship = not checked, not flipped)",
    afterUnrelated.availabilityStatus === "AVAILABLE" && afterUnrelated.lastSeenAt.getTime() === sevenHoursAgo2.getTime(),
  );

  const [afterTooFresh] = await db.select().from(schema.products).where(eq(schema.products.id, tooFresh.id));
  check(
    "sweep respected the TTL — a recently-checked saved item is left alone",
    afterTooFresh.availabilityStatus === "AVAILABLE",
  );

  // Running the sweep again must not duplicate the notification already sent.
  await db.update(schema.products).set({ lastSeenAt: sevenHoursAgo2 }).where(eq(schema.products.id, ownDirect.id));
  await runAvailabilitySweep();
  check(
    "repeated sweep run does not duplicate the notification",
    (await countUnreadNotifications(userD.id)) === 1,
  );

  // --- Pagination -----------------------------------------------------------
  await db.delete(schema.notifications).where(eq(schema.notifications.userId, userA.id));
  for (let i = 0; i < 25; i++) {
    await db.insert(schema.notifications).values({
      userId: userA.id,
      type: "SYSTEM",
      title: `Page test ${i}`,
      body: "b",
      createdAt: new Date(now.getTime() + i * 1000),
    });
  }
  const page1 = await listNotifications(userA.id, { limit: 20 });
  check("first page returns at most 20 items", page1.items.length === 20);
  check("first page reports hasMore", page1.hasMore === true);
  check("first page is newest-first", page1.items[0].title === "Page test 24");

  const page2 = await listNotifications(userA.id, {
    limit: 20,
    before: page1.items[page1.items.length - 1].createdAt,
  });
  check("second page returns the remaining 5 items", page2.items.length === 5);
  check("second page reports no more", page2.hasMore === false);
  const allTitles = new Set([...page1.items, ...page2.items].map((n) => n.title));
  check("pagination never repeats or skips a row", allTitles.size === 25);

  rmSync(dir, { recursive: true, force: true });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
