// Compass domain tables — everything beyond Auth.js's own user/account/
// session/verification-token tables (see ./auth.ts).
//
// Dialect note: same as auth.ts — text/integer/real map 1:1 onto
// drizzle-orm/pg-core's text/integer/real when this moves to Postgres.
// JSON-shaped columns (arrays, nested objects) are stored as
// `text("...", { mode: "json" })`, which Postgres can hold as jsonb by
// swapping one type on the pg-core version of this file.

import { sqliteTable, text, integer, real, uniqueIndex, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { users } from "./auth";

function id() {
  return text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
}

// ---------------------------------------------------------------------
// 5. User profile persistence — one row per user, mirrors
//    UserStyleProfile (src/types/style.ts) field-for-field so the
//    repository layer (lib/user/profile.ts) can map straight across
//    without duplicating the shape.
// ---------------------------------------------------------------------
export const styleProfiles = sqliteTable("style_profile", {
  userId: text("userId")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  styleArchetypes: text("styleArchetypes", { mode: "json" }).$type<string[]>().notNull().default([]),
  preferredFit: text("preferredFit"),
  preferredColors: text("preferredColors", { mode: "json" }).$type<string[]>().notNull().default([]),
  dislikedColors: text("dislikedColors", { mode: "json" }).$type<string[]>().notNull().default([]),
  preferredBrands: text("preferredBrands", { mode: "json" }).$type<string[]>().notNull().default([]),
  dislikedBrands: text("dislikedBrands", { mode: "json" }).$type<string[]>().notNull().default([]),
  budgetRange: text("budgetRange"),
  // UserLocation, flattened — avoids a second table for a 1:1 relation.
  locationCity: text("locationCity"),
  locationCountry: text("locationCountry"),
  locationLatitude: real("locationLatitude"),
  locationLongitude: real("locationLongitude"),
  locationTimezone: text("locationTimezone"),
  locationSource: text("locationSource"),
  favoriteCategories: text("favoriteCategories", { mode: "json" }).$type<string[]>().notNull().default([]),
  dislikedCategories: text("dislikedCategories", { mode: "json" }).$type<string[]>().notNull().default([]),
  genderPreference: text("genderPreference"),
  intent: text("intent"),
  mood: text("mood"),
  // Display-currency preference (EUR/USD/GBP) — see lib/currency/.
  // Presentation-only: never affects eBay search/price filters, which
  // stay in whatever currency the eBay API expects (see
  // lib/ebay/filters.ts's DEFAULT_CURRENCY comment).
  currency: text("currency"),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

// ---------------------------------------------------------------------
// 6. User activity
// ---------------------------------------------------------------------
export const viewedProducts = sqliteTable(
  "viewed_product",
  {
    id: id(),
    userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    productId: text("productId").notNull(),
    provider: text("provider").notNull().default("ebay"),
    viewedAt: integer("viewedAt", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [
    // "Recently viewed" is CURRENT STATE per (user, product) — the
    // latest time you opened it — not an append-only visit log, so
    // viewing the same product twice must update one row's viewedAt,
    // never insert a second row. Without this, repeat views (which do
    // happen innocuously — e.g. a client effect re-firing once
    // session status resolves from "loading" to "authenticated") show
    // up as visibly duplicated entries in Overview's Recently Viewed.
    // See recordViewedProduct's onConflictDoUpdate.
    uniqueIndex("viewed_product_user_product_uq").on(t.userId, t.productId),
    index("viewed_product_user_idx").on(t.userId),
    index("viewed_product_product_idx").on(t.productId),
  ],
);

export const savedProducts = sqliteTable(
  "saved_product",
  {
    id: id(),
    userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    productId: text("productId").notNull(),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("saved_product_user_product_uq").on(t.userId, t.productId),
    index("saved_product_user_idx").on(t.userId),
  ],
);

export const savedLooks = sqliteTable(
  "saved_look",
  {
    id: id(),
    userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    lookId: text("lookId").notNull(),
    // A permanent, reconstructable copy of the look as it existed at
    // save time (title/components/products via the `looks` +
    // `lookProducts` tables — see createLook/lib/db/repositories/look.ts),
    // separate from `lookId` above. `lookId` stays whatever ephemeral id
    // the client already keys its "is this saved" checks on (an Explore
    // session's in-memory look id, or /look's own generated id) so the
    // UI's save/unsave toggle behavior is unchanged; `snapshotLookId` is
    // what the Saved page actually renders from, so a saved look stays
    // displayable even after the Explore session/pool that originally
    // produced it is long gone. Nullable for pre-existing rows saved
    // before this column existed.
    snapshotLookId: text("snapshotLookId").references(() => looks.id, { onDelete: "set null" }),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("saved_look_user_look_uq").on(t.userId, t.lookId),
    index("saved_look_user_idx").on(t.userId),
  ],
);

// Recently-viewed LOOKS, server side (section 4: combined with
// viewed_product for Overview's single chronological "Recently
// Viewed" list). Same snapshot approach as savedLooks above and for
// the same reason — a look viewed a while ago must still be
// displayable after the Explore pool that showed it is gone.
export const viewedLooks = sqliteTable(
  "viewed_look",
  {
    id: id(),
    userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    lookId: text("lookId").notNull(),
    snapshotLookId: text("snapshotLookId").references(() => looks.id, { onDelete: "set null" }),
    viewedAt: integer("viewedAt", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [
    // Same "current state per (user, look), not a log" reasoning as
    // viewed_product's unique index above — see that comment.
    uniqueIndex("viewed_look_user_look_uq").on(t.userId, t.lookId),
    index("viewed_look_user_idx").on(t.userId),
  ],
);

// Likes/dislikes on either a product or a look — mirrors the existing
// client-side PreferenceSignal concept (lib/style/preferences.tsx) but
// persisted. "signalType" is "like" | "dislike".
//
// Product-scoped rows are CURRENT STATE, not a log: a partial unique
// index on (userId, productId) — only enforced when productId is
// set — means a user has at most one live signal per product, and the
// repository upserts into it (like -> dislike or a repeat click both
// update the same row) instead of inserting a new row every time.
// Look-scoped rows (productId null, lookId set) are untouched by this
// constraint and keep the original insert-only behavior, since
// per-look signals aren't part of this feature.
export const preferenceSignals = sqliteTable(
  "preference_signal",
  {
    id: id(),
    userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    productId: text("productId"),
    lookId: text("lookId"),
    signalType: text("signalType").notNull(),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [
    index("preference_signal_user_idx").on(t.userId),
    uniqueIndex("preference_signal_user_product_uq")
      .on(t.userId, t.productId)
      .where(sql`${t.productId} is not null`),
  ],
);

// Behavioral event log — persisted twin of client-side PreferenceEvent
// (src/types/events.ts). userId is nullable so anonymous-session
// events could in principle be batched here later; today only
// authenticated events are persisted (see api/activity/events).
export const events = sqliteTable(
  "event",
  {
    id: id(),
    userId: text("userId").references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    productId: text("productId"),
    lookId: text("lookId"),
    category: text("category"),
    brand: text("brand"),
    price: real("price"),
    source: text("source"),
    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
    timestamp: integer("timestamp", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [index("event_user_idx").on(t.userId), index("event_type_idx").on(t.type)],
);

// ---------------------------------------------------------------------
// 12. In-app notifications — a user-facing inbox, distinct from
//     technical_log (diagnostic-only, 7-day retention, never
//     user-facing). Created only when something the user has a
//     persisted relationship with changes (a saved/favorited item goes
//     unavailable, a saved Look's item goes unavailable, a referral
//     signs up) — never a blast to every user. See
//     lib/db/repositories/notifications.ts for reads/writes and
//     lib/maintenance/cleanup.ts for its own 90-day retention.
// ---------------------------------------------------------------------
export const notifications = sqliteTable(
  "notification",
  {
    id: id(),
    userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // ITEM_UNAVAILABLE | LOOK_ITEM_UNAVAILABLE | REFERRAL | SYSTEM
    title: text("title").notNull(),
    body: text("body").notNull(),
    entityType: text("entityType"), // "item" | "look" | null
    entityId: text("entityId"),
    // Idempotency key, scoped per user by the partial unique index
    // below — e.g. "item_unavailable:{providerItemId}:{unavailableAtMs}"
    // — so the SAME event (an item's availability check, a referral
    // signup) can never generate more than one notification per user,
    // no matter how many times the trigger path re-runs. Null for ad
    // hoc SYSTEM notifications, which aren't deduped against each other.
    dedupeKey: text("dedupeKey"),
    readAt: integer("readAt", { mode: "timestamp_ms" }),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [
    index("notification_user_created_idx").on(t.userId, t.createdAt),
    index("notification_user_read_idx").on(t.userId, t.readAt),
    uniqueIndex("notification_user_dedupe_uq")
      .on(t.userId, t.dedupeKey)
      .where(sql`${t.dedupeKey} is not null`),
  ],
);

// ---------------------------------------------------------------------
// 13. Payments and subscriptions (NOWPayments crypto payments, step 2
//     of the payments spec — backend infrastructure only, no UI/flow
//     wired to it yet). See lib/db/repositories/payments.ts for reads/
//     writes and lib/payments/nowpayments/{checkout,webhook}.ts for the
//     orchestration that writes these.
//
//     `payment` is the durable record of every payment attempt, one row
//     per NOWPayments payment_id, created BEFORE the create-payment
//     endpoint ever returns success (never inferred after the fact from
//     an IPN alone) and updated in place by the IPN webhook as
//     NOWPayments reports status transitions (waiting -> confirming ->
//     ... -> finished/failed/expired/refunded). `subscription` is
//     created only once a payment's status reaches "finished" — a
//     partial unique index enforces at most one ACTIVE subscription per
//     user, and a plain unique index on paymentId means the exact same
//     payment can never activate two subscriptions no matter how many
//     times its "finished" IPN is delivered (NOWPayments retries IPNs
//     that aren't acknowledged, so idempotency here is not optional).
// ---------------------------------------------------------------------
export const payments = sqliteTable(
  "payment",
  {
    id: id(),
    userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().default("nowpayments"),
    // NOWPayments' own payment_id — the identity a repeated/duplicate
    // IPN is matched against. Must be unique (section 1's "a NOWPayments
    // payment ID must be unique").
    providerPaymentId: text("providerPaymentId").notNull(),
    // Our own idempotency reference, generated before calling
    // NOWPayments and sent as their `order_id` — lets a request that
    // times out after NOWPayments accepted it but before our response
    // came back be recognized as "already created" rather than retried
    // into a second payment.
    orderId: text("orderId").notNull(),
    priceAmount: real("priceAmount").notNull(),
    priceCurrency: text("priceCurrency").notNull(),
    payCurrency: text("payCurrency"),
    payAmount: real("payAmount"),
    payAddress: text("payAddress"),
    // waiting | confirming | confirmed | sending | partially_paid |
    // finished | failed | expired | refunded — NOWPayments' own status
    // vocabulary, stored verbatim rather than mapped to a narrower enum
    // so a status this app doesn't specially handle yet is still
    // visible/auditable instead of silently coerced.
    status: text("status").notNull().default("waiting"),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
    completedAt: integer("completedAt", { mode: "timestamp_ms" }),
  },
  (t) => [
    uniqueIndex("payment_provider_payment_id_uq").on(t.provider, t.providerPaymentId),
    uniqueIndex("payment_order_id_uq").on(t.orderId),
    index("payment_user_idx").on(t.userId),
    index("payment_user_status_idx").on(t.userId, t.status),
  ],
);

export const subscriptions = sqliteTable(
  "subscription",
  {
    id: id(),
    userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    // "active" is the only status this MVP ever writes; the column
    // stays free text (not a narrower type) so a future cancellation/
    // expiry-sweep feature can write "canceled"/"expired" without a
    // schema change.
    status: text("status").notNull().default("active"),
    startedAt: integer("startedAt", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
    expiresAt: integer("expiresAt", { mode: "timestamp_ms" }).notNull(),
    paymentId: text("paymentId")
      .notNull()
      .references(() => payments.id, { onDelete: "restrict" }),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [
    index("subscription_user_idx").on(t.userId),
    // At most one payment ever activates one subscription — the DB-
    // level idempotency guard a repeated "finished" IPN relies on
    // (onConflictDoNothing target), not an application-level
    // check-then-insert race.
    uniqueIndex("subscription_payment_uq").on(t.paymentId),
    // At most one ACTIVE subscription per user at a time (section 4:
    // "do not create duplicate active subscriptions") — enforced only
    // while status='active', so a later canceled/expired history for
    // the same user is never blocked by this index.
    uniqueIndex("subscription_user_active_uq")
      .on(t.userId, t.status)
      .where(sql`${t.status} = 'active'`),
  ],
);

// ---------------------------------------------------------------------
// 9. Sellers
// ---------------------------------------------------------------------
export const sellers = sqliteTable(
  "seller",
  {
    id: id(),
    provider: text("provider").notNull().default("ebay"),
    providerSellerId: text("providerSellerId").notNull(),
    name: text("name").notNull(),
    rating: real("rating"),
    feedbackCount: integer("feedbackCount"),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [uniqueIndex("seller_provider_id_uq").on(t.provider, t.providerSellerId)],
);

// ---------------------------------------------------------------------
// 8. Product cache
// ---------------------------------------------------------------------
export const products = sqliteTable(
  "product",
  {
    id: id(),
    provider: text("provider").notNull().default("ebay"),
    providerItemId: text("providerItemId").notNull(),
    title: text("title").notNull(),
    brand: text("brand"),
    category: text("category"),
    gender: text("gender"),
    price: real("price"),
    currency: text("currency"),
    condition: text("condition"),
    sellerId: text("sellerId").references(() => sellers.id, { onDelete: "set null" }),
    sellerName: text("sellerName"),
    imageUrl: text("imageUrl"),
    productUrl: text("productUrl"),
    availability: text("availability"),
    // Lifecycle status (section 6-9 of the availability spec) — distinct
    // from `availability` above, which is free-text stock-quantity copy
    // from eBay ("3 available"), not a lifecycle state. AVAILABLE by
    // default: every row starts life as a just-fetched, therefore live,
    // product. `lastSeenAt` below doubles as "last availability check"
    // (see lib/products/availability.ts) rather than adding a duplicate
    // timestamp column — it's already refreshed on every upsertProduct
    // call, which only ever runs off a fresh eBay fetch.
    availabilityStatus: text("availabilityStatus").notNull().default("AVAILABLE"),
    // Set once, the first time a check finds the item no longer
    // available — never bumped forward on subsequent re-checks, so this
    // is the stable start of the 7-day "still show a status badge, then
    // drop from the active Overview feed" window. Null while AVAILABLE.
    unavailableAt: integer("unavailableAt", { mode: "timestamp_ms" }),
    lastSeenAt: integer("lastSeenAt", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("product_provider_item_uq").on(t.provider, t.providerItemId),
    index("product_provider_item_idx").on(t.providerItemId),
    index("product_brand_idx").on(t.brand),
    index("product_category_idx").on(t.category),
    index("product_gender_idx").on(t.gender),
    index("product_seller_idx").on(t.sellerId),
    index("product_updated_idx").on(t.updatedAt),
    // Powers the TTL "which cached rows are stale" scan (section 7)
    // and the daily cleanup's "unavailable for 7+ days" scan
    // (section 9).
    index("product_availability_status_idx").on(t.availabilityStatus),
    index("product_unavailable_at_idx").on(t.unavailableAt),
  ],
);

// ---------------------------------------------------------------------
// 11. Technical log retention (section 11-13 of the branding/lifecycle
//     spec). Deliberately separate from any business/audit data — see
//     lib/maintenance/cleanup.ts, the only place that ever deletes from
//     this table. Nothing else in the app should treat this as
//     persistent storage; it exists purely so ad hoc technical events
//     (an eBay API failure, a cleanup run's own summary) have somewhere
//     to go without growing the DB unboundedly.
// ---------------------------------------------------------------------
export const technicalLogs = sqliteTable(
  "technical_log",
  {
    id: id(),
    // Free-text category, not a foreign key to anything — e.g.
    // "ebay_api_error", "availability_check", "cleanup_run". Kept
    // loose on purpose: this table is diagnostic, not a schema other
    // features depend on.
    source: text("source").notNull(),
    message: text("message").notNull(),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [
    // The only query this table ever needs to run fast: "everything
    // older than N days" for the daily retention sweep.
    index("technical_log_created_at_idx").on(t.createdAt),
  ],
);

// ---------------------------------------------------------------------
// 10. Referral attribution (shareable Look/Item links, section 5-7 of
//     the shareable-links spec).
//
// Two tables, matching the spec's "click / signup / paid" funnel:
//
// - referralVisit: an anonymous CLICK on a ?ref= link. Logged on
//   every visit (not deduped) so later funnel analysis can see
//   click volume per code/source. Never permanently associates two
//   users by itself — see the "first capture attribution, don't
//   immediately assign it" requirement.
// - referral: the actual referrer<->referred relationship, created
//   once at signup time (see auth.ts's events.createUser) from
//   whatever referral code was captured in the anonymous visitor's
//   cookie. Unique on referredUserId so a user can only ever be
//   attributed to one referrer, and re-running signup/merge logic
//   can never create a duplicate row (idempotent by construction,
//   not by an extra existence check).
// ---------------------------------------------------------------------
export const referralVisits = sqliteTable(
  "referral_visit",
  {
    id: id(),
    referralCode: text("referralCode").notNull(),
    sourceType: text("sourceType").notNull(), // "look" | "item"
    sourceId: text("sourceId").notNull(),
    // Anonymous visitor id (see the compass_vid cookie in
    // api/referral/track) — best-effort, not a durable identity.
    visitorId: text("visitorId"),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [
    index("referral_visit_code_idx").on(t.referralCode),
    index("referral_visit_visitor_idx").on(t.visitorId),
    // Powers the retention sweep in lib/maintenance/cleanup.ts — this
    // is click-log data (analytics), not the Referral relationship
    // itself, so it's the "temporary attribution data" the cleanup
    // spec calls out, not something that needs to live forever.
    index("referral_visit_created_at_idx").on(t.createdAt),
  ],
);

export const referrals = sqliteTable(
  "referral",
  {
    id: id(),
    referrerUserId: text("referrerUserId").notNull().references(() => users.id, { onDelete: "cascade" }),
    referredUserId: text("referredUserId").notNull().references(() => users.id, { onDelete: "cascade" }),
    sourceType: text("sourceType"), // "look" | "item" | null (unknown)
    sourceId: text("sourceId"),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [
    // A user can be REFERRED at most once, ever — this is what makes
    // signup attribution idempotent (onConflictDoNothing on this
    // index) rather than relying on a check-then-insert race.
    uniqueIndex("referral_referred_user_uq").on(t.referredUserId),
    index("referral_referrer_idx").on(t.referrerUserId),
  ],
);

// ---------------------------------------------------------------------
// 7. Looks and products
// ---------------------------------------------------------------------
export const looks = sqliteTable("look", {
  id: id(),
  // Nullable: system-generated/anonymous looks (Explore's rule-based
  // feed) have no owning user. A user-authored look from /look always
  // sets this once the merge/save path runs.
  userId: text("userId").references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  language: text("language"),
  gender: text("gender"),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const lookProducts = sqliteTable(
  "look_product",
  {
    id: id(),
    lookId: text("lookId").notNull().references(() => looks.id, { onDelete: "cascade" }),
    productId: text("productId").notNull().references(() => products.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    role: text("role"),
  },
  (t) => [index("look_product_look_idx").on(t.lookId)],
);
