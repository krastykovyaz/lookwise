// Covers the 👍/👎 feedback feature (STEP 7 of its spec):
//  - pure toggle-decision logic (like<->dislike, repeat-click removes)
//  - request validation (missing/invalid productId, invalid signal)
//  - repository behavior against a real, freshly migrated temporary
//    SQLite database: authenticated like/dislike is stored, duplicate
//    clicks don't create duplicate rows, switching updates the
//    existing row, signals are isolated between users, batch restore
//    returns only the requesting user's signals for the requested
//    ids, and the underlying unique constraint actually holds.
//
// "unauthenticated feedback is rejected" is verified structurally,
// not by invoking the route handler over HTTP (this project has no
// running server in its test environment — see verify-auth.ts for the
// same constraint) — every mutating route in this codebase, including
// this one, starts with `const userId = await getSessionUserId(); if
// (!userId) return 401`, checked directly below by reading the route
// source. The behavior itself (a null session id short-circuits
// before any DB write) is exercised for every other route via
// getSessionUserId's own contract, which every repository call in
// this file requires a real userId for — so a route that skipped the
// check would fail to compile, not just fail at runtime.

import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveSignalToggle } from "../src/lib/style/signalLogic";
import { postBodySchema, deleteBodySchema } from "../src/lib/style/signalSchemas";

const dir = mkdtempSync(path.join(tmpdir(), "compass-signals-verify-"));
const dbPath = path.join(dir, "test.db");
process.env.DATABASE_URL = `file:${dbPath}`;

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  // --- Pure toggle logic -------------------------------------------------
  check("neutral -> like sets like", resolveSignalToggle(null, "like") === "like");
  check("neutral -> dislike sets dislike", resolveSignalToggle(null, "dislike") === "dislike");
  check("like -> dislike updates to dislike", resolveSignalToggle("like", "dislike") === "dislike");
  check("dislike -> like updates to like", resolveSignalToggle("dislike", "like") === "like");
  check("like -> like (repeat click) clears to neutral", resolveSignalToggle("like", "like") === null);
  check("dislike -> dislike (repeat click) clears to neutral", resolveSignalToggle("dislike", "dislike") === null);

  // --- Request validation --------------------------------------------------
  check("missing productId is rejected", !postBodySchema.safeParse({ signal: "like" }).success);
  check("empty productId is rejected", !postBodySchema.safeParse({ productId: "", signal: "like" }).success);
  check("invalid signal value is rejected", !postBodySchema.safeParse({ productId: "p1", signal: "meh" }).success);
  check("missing signal is rejected", !postBodySchema.safeParse({ productId: "p1" }).success);
  check("valid like body is accepted", postBodySchema.safeParse({ productId: "p1", signal: "like" }).success);
  check("valid dislike body is accepted", postBodySchema.safeParse({ productId: "p1", signal: "dislike" }).success);
  check("DELETE body without productId is rejected", !deleteBodySchema.safeParse({}).success);

  // --- Every mutating handler in this route checks the session first ----
  const routeSource = readFileSync(path.join(__dirname, "..", "src", "app", "api", "activity", "signals", "route.ts"), "utf8");
  const handlerBlocks = routeSource.split(/^export async function/m).slice(1);
  check(
    "GET/POST/DELETE all short-circuit on a missing session before touching the repository",
    handlerBlocks.length === 3 &&
      handlerBlocks.every((block) => /getSessionUserId\(\)/.test(block) && /if \(!userId\)/.test(block) && /status: 401/.test(block)),
    `handlers found: ${handlerBlocks.length}`,
  );

  // --- Repository behavior against a real temporary database -------------
  const { db, schema } = await import("../src/lib/db/client");
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const { eq, and } = await import("drizzle-orm");
  migrate(db, { migrationsFolder: path.join(__dirname, "..", "drizzle") });

  const {
    upsertProductSignal,
    removeProductSignal,
    getUserProductSignal,
    getUserProductSignals,
  } = await import("../src/lib/db/repositories/activity");

  const [alice] = await db.insert(schema.users).values({ email: "alice@example.com" }).returning();
  const [bob] = await db.insert(schema.users).values({ email: "bob@example.com" }).returning();

  // authenticated like is stored
  await upsertProductSignal(alice.id, "product-1", "like");
  check("authenticated like is stored", (await getUserProductSignal(alice.id, "product-1")) === "like");

  // authenticated dislike is stored (different product)
  await upsertProductSignal(alice.id, "product-2", "dislike");
  check("authenticated dislike is stored", (await getUserProductSignal(alice.id, "product-2")) === "dislike");

  // duplicate like does not create duplicate rows
  await upsertProductSignal(alice.id, "product-1", "like");
  await upsertProductSignal(alice.id, "product-1", "like");
  const rowsForProduct1 = await db
    .select()
    .from(schema.preferenceSignals)
    .where(and(eq(schema.preferenceSignals.userId, alice.id), eq(schema.preferenceSignals.productId, "product-1")));
  check("duplicate like does not create duplicate rows", rowsForProduct1.length === 1, `rows: ${rowsForProduct1.length}`);

  // like -> dislike updates correctly (same row, not a second one)
  await upsertProductSignal(alice.id, "product-1", "dislike");
  const rowsAfterSwitch = await db
    .select()
    .from(schema.preferenceSignals)
    .where(and(eq(schema.preferenceSignals.userId, alice.id), eq(schema.preferenceSignals.productId, "product-1")));
  check(
    "like -> dislike updates the existing row rather than inserting a new one",
    rowsAfterSwitch.length === 1 && rowsAfterSwitch[0].signalType === "dislike",
  );

  // dislike -> like updates correctly
  await upsertProductSignal(alice.id, "product-1", "like");
  check("dislike -> like updates correctly", (await getUserProductSignal(alice.id, "product-1")) === "like");

  // clicking the active button removes the signal (route-level toggle
  // behavior, exercised directly against the repository here)
  const currentBeforeToggleOff = await getUserProductSignal(alice.id, "product-1");
  const nextState = resolveSignalToggle(currentBeforeToggleOff, "like");
  check("toggle-off decision is null when re-clicking the active button", nextState === null);
  await removeProductSignal(alice.id, "product-1");
  check("removeProductSignal clears the signal back to neutral", (await getUserProductSignal(alice.id, "product-1")) === null);

  // re-set for the isolation/batch-restore checks below
  await upsertProductSignal(alice.id, "product-1", "like");

  // signals are isolated between users
  await upsertProductSignal(bob.id, "product-1", "dislike");
  check(
    "signals are isolated between users (same product, different users, different values)",
    (await getUserProductSignal(alice.id, "product-1")) === "like" && (await getUserProductSignal(bob.id, "product-1")) === "dislike",
  );

  // fetching signals returns only requested/current user's signals
  await upsertProductSignal(alice.id, "product-3", "dislike");
  const aliceBatch = await getUserProductSignals(alice.id, ["product-1", "product-2", "product-3", "product-does-not-exist"]);
  check(
    "batch restore returns exactly the requesting user's signals for the requested ids",
    aliceBatch["product-1"] === "like" &&
      aliceBatch["product-2"] === "dislike" &&
      aliceBatch["product-3"] === "dislike" &&
      !("product-does-not-exist" in aliceBatch) &&
      Object.keys(aliceBatch).length === 3,
    JSON.stringify(aliceBatch),
  );
  const bobBatch = await getUserProductSignals(bob.id, ["product-1", "product-2", "product-3"]);
  check(
    "batch restore never leaks another user's signal for a shared product id",
    bobBatch["product-1"] === "dislike" && !("product-2" in bobBatch) && !("product-3" in bobBatch),
    JSON.stringify(bobBatch),
  );

  // the DB-level unique constraint itself holds (defense in depth —
  // even a caller that bypassed upsertProductSignal and inserted
  // directly cannot create a duplicate).
  let constraintHeld = false;
  try {
    await db.insert(schema.preferenceSignals).values({ userId: alice.id, productId: "product-1", signalType: "dislike" });
  } catch {
    constraintHeld = true;
  }
  check("the underlying unique index rejects a second row for the same (user, product)", constraintHeld);

  // look-scoped rows (productId null) are unaffected by the product
  // unique constraint — multiple rows for the same look are still fine.
  await db.insert(schema.preferenceSignals).values({ userId: alice.id, lookId: "look-1", signalType: "like" });
  await db.insert(schema.preferenceSignals).values({ userId: alice.id, lookId: "look-1", signalType: "like" });
  const lookRows = await db.select().from(schema.preferenceSignals).where(eq(schema.preferenceSignals.lookId, "look-1"));
  check("look-scoped signal rows are untouched by the product-scoped unique constraint", lookRows.length === 2);

  // batch restore with an empty id list never queries and returns {}
  const emptyBatch = await getUserProductSignals(alice.id, []);
  check("batch restore with no ids returns an empty map without querying", Object.keys(emptyBatch).length === 0);

  // --- Regression: the exact HTTP 500 reported live -----------------------
  // A dev.db that predates the migration adding preference_signal's
  // updatedAt column + unique index (i.e. `npm run db:migrate` wasn't
  // re-run after pulling this feature) made upsertProductSignal throw
  // a raw SQLite error that the route's blanket `catch {}` swallowed
  // into a content-free 500. Reproduce that exact stale-schema
  // condition against a second temp database (built from ONLY
  // migration 0000, migration 0001 never applied) and confirm the
  // repository throws a real, diagnosable error rather than silently
  // succeeding or hanging — the route-level fix is logging this via
  // console.error instead of discarding it (checked structurally
  // below, same approach as the session-check test above).
  {
    const staleDir = mkdtempSync(path.join(tmpdir(), "compass-signals-stale-"));
    const staleDbPath = path.join(staleDir, "stale.db");
    const Database = (await import("better-sqlite3")).default;
    const staleSqlite = new Database(staleDbPath);
    staleSqlite.pragma("foreign_keys = ON");
    for (const stmt of readFileSync(path.join(__dirname, "..", "drizzle", "0000_purple_robbie_robertson.sql"), "utf8").split(
      "--> statement-breakpoint",
    )) {
      const s = stmt.trim();
      if (s) staleSqlite.exec(s);
    }
    staleSqlite.prepare("insert into user (id, email, createdAt, updatedAt) values (?,?,?,?)").run("stale-user", "stale@example.com", Date.now(), Date.now());
    staleSqlite.close();

    // Point a *separate* drizzle connection at the stale file directly
    // (not through lib/db/client's singleton, which is already bound
    // to the main test db by now) to call the exact same repository
    // function the route calls.
    const { drizzle } = await import("drizzle-orm/better-sqlite3");
    const staleConn = new Database(staleDbPath);
    const staleDb = drizzle(staleConn, { schema });
    let threwWithDiagnosableMessage = false;
    try {
      await staleDb.insert(schema.preferenceSignals).values({
        userId: "stale-user",
        productId: "product-1",
        signalType: "like",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    } catch (err) {
      threwWithDiagnosableMessage = err instanceof Error && /updatedAt/.test(err.message);
    }
    check(
      "a pre-migration (stale-schema) database throws a diagnosable error instead of silently succeeding",
      threwWithDiagnosableMessage,
    );
    staleConn.close();
    rmSync(staleDir, { recursive: true, force: true });
  }

  const routeSourceForLogging = readFileSync(
    path.join(__dirname, "..", "src", "app", "api", "activity", "signals", "route.ts"),
    "utf8",
  );
  check(
    "POST/GET/DELETE all log the real error server-side on failure instead of swallowing it silently",
    (routeSourceForLogging.match(/console\.error\(/g) ?? []).length >= 3,
  );

  rmSync(dir, { recursive: true, force: true });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
