// Auth.js (NextAuth v5) adapter tables.
//
// Shaped to match @auth/drizzle-adapter's expected column names/types
// exactly (see node_modules/@auth/drizzle-adapter/lib/sqlite.d.ts) so
// SQLiteDrizzleAdapter can be handed this schema directly.
//
// Dialect note (see README "Migrating to PostgreSQL"): every column
// here uses a type that has a 1:1 equivalent in drizzle-orm/pg-core
// (text -> text, integer({mode:"timestamp"}) -> timestamp, integer
// autoincrement -> serial/identity). Moving to Postgres later means
// re-declaring these tables against pg-core with the same names and
// swapping the driver in client.ts — the repository layer above never
// touches column types directly, so nothing else changes.

import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: integer("emailVerified", { mode: "timestamp_ms" }),
  image: text("image"),
  // Public, non-sensitive referral code (e.g. "K7X9P2") — safe to put
  // in a shared URL's ?ref= param. Never the internal id/email/token.
  // Nullable: generated lazily (see lib/db/repositories/referral.ts's
  // ensureReferralCode) rather than at row-creation time, so this
  // column can be backfilled without touching the Auth.js adapter's
  // own createUser call.
  referralCode: text("referralCode").unique(),
  createdAt: integer("createdAt", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  lastLoginAt: integer("lastLoginAt", { mode: "timestamp_ms" }),
});

export const accounts = sqliteTable(
  "account",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => [
    primaryKey({ columns: [account.provider, account.providerAccountId] }),
  ],
);

export const sessions = sqliteTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: integer("expires", { mode: "timestamp_ms" }).notNull(),
});

// Magic-link tokens. Auth.js deletes a row the moment it's consumed
// (single-use) and treats an already-consumed/missing token as
// invalid — see auth.config.ts's sendVerificationRequest and the
// SECURITY notes in README for the expiry window.
export const verificationTokens = sqliteTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: integer("expires", { mode: "timestamp_ms" }).notNull(),
  },
  (vt) => [primaryKey({ columns: [vt.identifier, vt.token] })],
);
