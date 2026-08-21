import "server-only";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as authSchema from "./schema/auth";
import * as domainSchema from "./schema/domain";
import fs from "node:fs";
import path from "node:path";

// Single combined schema object handed to drizzle() so relational
// queries (db.query.xxx) and the Auth.js adapter can both see every
// table. Swapping to Postgres later means importing
// drizzle-orm/node-postgres here instead and pointing DATABASE_URL at
// a postgres:// connection string — see README "Migrating to
// PostgreSQL". Nothing in lib/db/repositories or the API routes
// imports better-sqlite3 directly, so that swap is isolated to this
// one file plus the schema/*.ts column-type definitions.
export const schema = { ...authSchema, ...domainSchema };

declare global {
  var __compassSqlite: Database.Database | undefined;
}

function resolveDbPath(): string {
  const url = process.env.DATABASE_URL ?? "file:./dev.db";
  return url.startsWith("file:") ? url.slice("file:".length) : url;
}

// Reuse the connection across hot reloads in dev (same pattern every
// Next.js + better-sqlite3/Prisma singleton guide uses) — a fresh
// Database() per module reload would eventually exhaust file handles.
const sqlite = globalThis.__compassSqlite ?? new Database(resolveDbPath());
if (process.env.NODE_ENV !== "production") {
  globalThis.__compassSqlite = sqlite;
}
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });
export type Db = typeof db;

// Dev-time-only, best-effort check: this exact "stale dev.db missing a
// recent migration" mistake has caused two separate confusing 500s in
// this project already (the preference_signal.updatedAt column, then
// style_profile.currency) — both looked like application bugs from
// the browser console until someone traced them back to "forgot to
// re-run npm run db:migrate". This prints one loud, actionable warning
// at server startup instead of leaving the next person to rediscover
// the same root cause via a raw SqliteError. Never throws and never
// blocks a request — a failure here (missing folder in a deployed
// bundle, permissions, etc.) is silently skipped.
if (process.env.NODE_ENV !== "production") {
  try {
    const migrationsDir = path.join(process.cwd(), "drizzle");
    const fileCount = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).length;
    const hasTable = sqlite
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'`)
      .get();
    const appliedCount = hasTable
      ? (sqlite.prepare(`SELECT COUNT(*) AS c FROM __drizzle_migrations`).get() as { c: number }).c
      : 0;
    if (appliedCount < fileCount) {
      console.warn(
        `\n⚠️  Database schema is out of date: ${appliedCount}/${fileCount} migrations applied.\n` +
          `   Run "npm run db:migrate" and restart the dev server — otherwise you'll see\n` +
          `   confusing "no such column" 500s on routes that use the newer columns.\n`,
      );
    }
  } catch {
    // Best-effort only — never let this check itself break startup.
  }
}
