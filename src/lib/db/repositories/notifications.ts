import "server-only";
import { and, desc, eq, isNull, isNotNull, lt, count } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";

export type NotificationType = "ITEM_UNAVAILABLE" | "LOOK_ITEM_UNAVAILABLE" | "REFERRAL" | "SYSTEM";
export type NotificationEntityType = "item" | "look" | null;

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  entityType?: NotificationEntityType;
  entityId?: string | null;
  /** See schema/domain.ts's dedupeKey comment — omit only for ad hoc
   *  SYSTEM notifications that don't need duplicate-prevention. */
  dedupeKey?: string | null;
}

/** Idempotent via the partial unique index on (userId, dedupeKey) — an
 *  upsert-with-a-no-op-update rather than onConflictDoNothing (whose
 *  SQLite output places the partial index's WHERE after DO NOTHING,
 *  which SQLite rejects as a syntax error — verified against this
 *  drizzle-orm version; onConflictDoUpdate emits it correctly, before
 *  DO UPDATE, matching upsertProductSignal's proven working pattern in
 *  repositories/activity.ts). The `set` touches nothing real, so a
 *  duplicate event is a true no-op, never a second row and never a
 *  content change to the first one. */
export async function createNotification(input: CreateNotificationInput) {
  const [row] = await db
    .insert(schema.notifications)
    .values({
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      dedupeKey: input.dedupeKey ?? null,
    })
    .onConflictDoUpdate({
      target: [schema.notifications.userId, schema.notifications.dedupeKey],
      targetWhere: isNotNull(schema.notifications.dedupeKey),
      set: { id: schema.notifications.id },
    })
    .returning();
  return row ?? null;
}

export interface NotificationEntry {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  entityType: NotificationEntityType;
  entityId: string | null;
  readAt: Date | null;
  createdAt: Date;
}

export interface ListNotificationsResult {
  items: NotificationEntry[];
  hasMore: boolean;
}

const LIST_LIMIT_DEFAULT = 20;
const LIST_LIMIT_MAX = 50;

/** Newest first, capped page size — never an unbounded fetch (section
 *  7). `before` pages further back in time (a createdAt cursor, not
 *  OFFSET, so a row inserted between pages can't shift the next page's
 *  results) once the caller has exhausted what's already loaded. */
export async function listNotifications(
  userId: string,
  { limit = LIST_LIMIT_DEFAULT, before }: { limit?: number; before?: Date } = {},
): Promise<ListNotificationsResult> {
  const cappedLimit = Math.min(Math.max(limit, 1), LIST_LIMIT_MAX);
  const rows = await db
    .select()
    .from(schema.notifications)
    .where(
      before
        ? and(eq(schema.notifications.userId, userId), lt(schema.notifications.createdAt, before))
        : eq(schema.notifications.userId, userId),
    )
    .orderBy(desc(schema.notifications.createdAt))
    // Fetch one extra row purely to detect "is there more" without a
    // second COUNT query.
    .limit(cappedLimit + 1);

  const hasMore = rows.length > cappedLimit;
  const page = hasMore ? rows.slice(0, cappedLimit) : rows;
  return {
    items: page.map((row) => ({
      id: row.id,
      type: row.type as NotificationType,
      title: row.title,
      body: row.body,
      entityType: row.entityType as NotificationEntityType,
      entityId: row.entityId,
      readAt: row.readAt,
      createdAt: row.createdAt,
    })),
    hasMore,
  };
}

export async function countUnreadNotifications(userId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(schema.notifications)
    .where(and(eq(schema.notifications.userId, userId), isNull(schema.notifications.readAt)));
  return row?.value ?? 0;
}

/** Scoped to (id, userId) in the WHERE clause itself — never trust a
 *  notification id alone (section 14: a client can't read/mark another
 *  account's notifications). Returns the row so the caller can look up
 *  its entity link, or null if it doesn't exist / isn't this user's. */
export async function markNotificationRead(userId: string, id: string) {
  const [row] = await db
    .update(schema.notifications)
    .set({ readAt: new Date() })
    .where(and(eq(schema.notifications.id, id), eq(schema.notifications.userId, userId)))
    .returning();
  return row ?? null;
}

export async function markAllNotificationsRead(userId: string): Promise<number> {
  const rows = await db
    .update(schema.notifications)
    .set({ readAt: new Date() })
    .where(and(eq(schema.notifications.userId, userId), isNull(schema.notifications.readAt)))
    .returning({ id: schema.notifications.id });
  return rows.length;
}

export async function getNotificationForUser(userId: string, id: string) {
  const [row] = await db
    .select()
    .from(schema.notifications)
    .where(and(eq(schema.notifications.id, id), eq(schema.notifications.userId, userId)));
  return row ?? null;
}

/** Called from lib/products/availability.ts the moment a cached product
 *  row FIRST flips AVAILABLE -> UNAVAILABLE (never on repeat checks
 *  while it stays unavailable — that's what makes `row.unavailableAt`
 *  a stable per-EVENT timestamp safe to fold into the dedupe key
 *  below). Only notifies users with an actual persisted relationship
 *  to the item — never a blast to every user. */
export async function notifyUnavailableItem(row: {
  /** products.id — the internal row id, needed for the look_product join. */
  id: string;
  /** products.providerItemId — the eBay item id / client Product.id. */
  providerItemId: string;
  unavailableAt: Date;
}): Promise<void> {
  const eventKey = row.unavailableAt.getTime();

  const favoritedBy = await db
    .select({ userId: schema.savedProducts.userId })
    .from(schema.savedProducts)
    .where(eq(schema.savedProducts.productId, row.providerItemId));

  await Promise.all(
    favoritedBy.map((favorite) =>
      createNotification({
        userId: favorite.userId,
        type: "ITEM_UNAVAILABLE",
        title: "Item no longer available",
        body: "An item you saved is no longer available on eBay.",
        entityType: "item",
        entityId: row.providerItemId,
        dedupeKey: `item_unavailable:${row.providerItemId}:${eventKey}`,
      }),
    ),
  );

  // Saved Looks containing this item — joined via the permanent
  // looks/look_product snapshot tables (see saved_look's own comment
  // in schema/domain.ts for why snapshotLookId, not the ephemeral
  // client lookId, is the durable link here).
  const affectedLooks = await db
    .select({ userId: schema.savedLooks.userId, snapshotLookId: schema.savedLooks.snapshotLookId })
    .from(schema.lookProducts)
    .innerJoin(schema.savedLooks, eq(schema.savedLooks.snapshotLookId, schema.lookProducts.lookId))
    .where(eq(schema.lookProducts.productId, row.id));

  await Promise.all(
    affectedLooks
      .filter((look): look is { userId: string; snapshotLookId: string } => Boolean(look.snapshotLookId))
      .map((look) =>
        createNotification({
          userId: look.userId,
          type: "LOOK_ITEM_UNAVAILABLE",
          title: "Item in your Look is no longer available",
          body: "One item in your saved Look is no longer available on eBay.",
          entityType: "look",
          entityId: look.snapshotLookId,
          dedupeKey: `look_item_unavailable:${look.snapshotLookId}:${row.providerItemId}:${eventKey}`,
        }),
      ),
  );
}
