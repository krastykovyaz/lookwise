import "server-only";
import { and, asc, eq, exists, lt, or } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { fetchPublicProduct } from "@/lib/products/public";
import { logTechnicalEvent } from "@/lib/maintenance/logger";
import { notifyUnavailableItem } from "@/lib/db/repositories/notifications";
import type { AvailabilityStatus } from "@/types/product";

// 6h: availability is checked at most once per 6 hours for a cached
// product. Once eBay reports that it is gone, the product immediately
// becomes UNAVAILABLE in the app; the 7-day period is only the retention
// window before the temporary cache row is deleted by maintenance.
const CHECK_TTL_MS = 6 * 60 * 60 * 1000;
// Bounds how many stale rows get a live eBay re-check in one call —
// the "do not call eBay for every card every time Overview opens"
// guard (section 7). Even if every row in a batch is stale, only this
// many actually hit eBay per request; the rest just show their
// last-known status until a later request re-evaluates them.
const MAX_REFRESH_PER_CALL = 8;

type ProductRow = typeof schema.products.$inferSelect;

function isStale(row: ProductRow): boolean {
  return Date.now() - row.lastSeenAt.getTime() > CHECK_TTL_MS;
}

/** Refreshes availability for whichever of the given cached product
 *  rows are past the TTL, bounded to MAX_REFRESH_PER_CALL live eBay
 *  calls per invocation. Mutates the DB directly — callers re-read via
 *  their normal reconstruction path (dbProductToClientProduct already
 *  carries availabilityStatus/unavailableAt) rather than this function
 *  returning updated Product objects itself.
 *
 *  Called from lib/db/repositories/activity.ts's attachProducts, which
 *  backs Overview's Recently Viewed and the Saved page — both
 *  authenticated, bounded-size lists. Deliberately NOT wired into
 *  loadProductsByRowId/loadLooksByRowId's own internal queries, since
 *  those also serve the public, guest-facing /look/[lookId] and
 *  /item/[itemId] pages, where a reliable/fast Telegram preview matters
 *  more than freshness (see that spec's own stated priority order).
 *  Any status this writes still becomes visible on those public pages
 *  and inside a Look's components (section 16) passively — they read
 *  the same two columns on the same shared product row, they just
 *  don't trigger new eBay calls to refresh them. */
export async function refreshStaleAvailability(rows: ProductRow[]): Promise<void> {
  const stale = rows.filter(isStale).slice(0, MAX_REFRESH_PER_CALL);
  if (stale.length === 0) return;

  await Promise.all(
    stale.map(async (row) => {
      // fetchPublicProduct never throws (see lib/products/public.ts) —
      // null covers not-found, sold, ended, and transient API errors
      // alike, since eBay's Browse API getItem doesn't currently give
      // this app a way to tell those apart. UNAVAILABLE is the honest
      // generic bucket for all of them; SOLD/ENDED remain valid
      // statuses in the schema for a future, more specific signal
      // (e.g. a webhook) to set — this checker just never picks them.
      const live = await fetchPublicProduct(row.providerItemId);
      const now = new Date();
      const nextStatus: AvailabilityStatus = live ? "AVAILABLE" : "UNAVAILABLE";
      const wasAvailable = row.availabilityStatus === "AVAILABLE";

      const justWentUnavailable = nextStatus === "UNAVAILABLE" && wasAvailable;

      try {
        await db
          .update(schema.products)
          .set({
            availabilityStatus: nextStatus,
            lastSeenAt: now,
            updatedAt: now,
            ...(nextStatus === "AVAILABLE"
              ? { unavailableAt: null }
              : wasAvailable
                ? { unavailableAt: now } // first time it's gone — starts the 7-day clock
                : {}), // already unavailable — never push unavailableAt forward
          })
          .where(eq(schema.products.id, row.id));
      } catch (err) {
        console.error("[refreshStaleAvailability] failed to update", row.id, err);
        void logTechnicalEvent("availability_check", `update failed for product ${row.id}: ${(err as Error).message}`);
        return;
      }

      // Notify only users with an actual saved/favorited relationship
      // to this item (or a saved Look containing it) — never every
      // user. Best-effort: a notification failure must not undo the
      // availability update above or break the caller's product list.
      if (justWentUnavailable) {
        try {
          await notifyUnavailableItem({ id: row.id, providerItemId: row.providerItemId, unavailableAt: now });
        } catch (err) {
          console.error("[refreshStaleAvailability] notification creation failed for", row.id, err);
        }
      }
    }),
  );
}

// Bounds how many items one scheduled sweep checks against eBay —
// generous relative to MAX_REFRESH_PER_CALL (that one bounds a single
// *web request*, section 7's "don't call eBay for every card every
// time Overview opens") since this runs in the background on the same
// once-daily cadence as runCleanup, not on a request's critical path.
// Still a hard cap, not "check everything due" — an unbounded backlog
// works down gradually over successive runs instead of one run
// hammering eBay.
const SWEEP_BUDGET_PER_RUN = 40;

/** Finds AVAILABLE, stale, eBay-provider product rows that at least
 *  one user has an actual relationship with — favorited/saved
 *  directly, or saved inside a Look — via EXISTS subqueries against
 *  saved_product and look_product/saved_look. Never a product nobody
 *  cares about. Oldest-checked first, so a backlog rotates through
 *  fairly across runs rather than the same head of the table winning
 *  every time. */
async function findDueRelatedProducts(cutoff: Date, limit: number): Promise<ProductRow[]> {
  return db
    .select()
    .from(schema.products)
    .where(
      and(
        eq(schema.products.provider, "ebay"),
        eq(schema.products.availabilityStatus, "AVAILABLE"),
        lt(schema.products.lastSeenAt, cutoff),
        or(
          exists(
            db
              .select({ id: schema.savedProducts.id })
              .from(schema.savedProducts)
              .where(eq(schema.savedProducts.productId, schema.products.providerItemId)),
          ),
          exists(
            db
              .select({ id: schema.lookProducts.id })
              .from(schema.lookProducts)
              .innerJoin(schema.savedLooks, eq(schema.savedLooks.snapshotLookId, schema.lookProducts.lookId))
              .where(eq(schema.lookProducts.productId, schema.products.id)),
          ),
        ),
      ),
    )
    .orderBy(asc(schema.products.lastSeenAt))
    .limit(limit);
}

export interface AvailabilitySweepStats {
  candidatesChecked: number;
  ranAt: string;
}

/** The proactive counterpart to refreshStaleAvailability's reactive,
 *  per-page-load checks (Overview/Saved) — detects a favorited/saved
 *  item (or a saved Look's item) going unavailable even if nobody
 *  opens the app. Reuses refreshStaleAvailability itself for the
 *  actual eBay call + DB update + notification creation (section 4:
 *  "reuse the existing notification repository and dedupe mechanism"
 *  — that function is exactly where notifyUnavailableItem already
 *  lives, unmodified here), chunked to that function's own
 *  MAX_REFRESH_PER_CALL cap so this doesn't bypass the existing
 *  per-call eBay rate guard. Run from the same schedule as
 *  runCleanup (see instrumentation.ts and
 *  api/maintenance/cleanup/route.ts) rather than a second, competing
 *  scheduler. */
export async function runAvailabilitySweep(): Promise<AvailabilitySweepStats> {
  const cutoff = new Date(Date.now() - CHECK_TTL_MS);
  const due = await findDueRelatedProducts(cutoff, SWEEP_BUDGET_PER_RUN);

  for (let i = 0; i < due.length; i += MAX_REFRESH_PER_CALL) {
    await refreshStaleAvailability(due.slice(i, i + MAX_REFRESH_PER_CALL));
  }

  const stats: AvailabilitySweepStats = {
    candidatesChecked: due.length,
    ranAt: new Date().toISOString(),
  };
  console.log("[availability] proactive sweep complete:", stats);
  return stats;
}
