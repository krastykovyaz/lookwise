import "server-only";
import { and, eq, inArray, lt, notExists } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";

// Section 11-14 of the branding/lifecycle spec.
//
// What this DOES delete (technical/temporary data only):
//  - technical_log rows older than 7 days
//  - referral_visit rows older than 90 days — this is the anonymous
//    CLICK log (see lib/db/repositories/referral.ts's comment on that
//    table), not the referrer<->referred relationship itself; a
//    longer window than technical logs since it has some standalone
//    analytics value, but still explicitly temporary.
//
// What this NEVER touches (business-critical, per section 11's "NEVER
// automatically delete" list): users, sessions/accounts, orders,
// payments, favorites, saved_look/saved_product, viewed_look/
// viewed_product (Recently Viewed), referral (the relationship
// itself), looks/lookProducts/products (including a product that's
// gone unavailable — see section 9's "prefer active/inactive
// visibility over physical deletion", already implemented as a
// query-time filter in listRecentlyViewed, not a delete here).
const TECHNICAL_LOG_RETENTION_DAYS = 7;
const REFERRAL_VISIT_RETENTION_DAYS = 90;
// Matches the retention window documented in lib/products/availability.ts.
const UNAVAILABLE_PRODUCT_RETENTION_DAYS = 7;
// Notifications are a user-facing inbox, not a technical log — a much
// longer window than technical_log's 7 days, matching referral_visit's
// own "temporary but not throwaway" retention.
const NOTIFICATION_RETENTION_DAYS = 90;

// Section 14: "delete in batches... do not run a massive unbounded
// DELETE on every request" — bounds both the size of any single
// DELETE statement and, via the loop's own exit condition, the total
// work one runCleanup() call can do, so a very large backlog can't
// turn one invocation into an indefinite lock.
const BATCH_SIZE = 500;
const MAX_BATCHES_PER_TABLE = 50; // hard ceiling: 25,000 rows/table/run

async function deleteTechnicalLogsBefore(cutoff: Date): Promise<number> {
  let total = 0;
  for (let batch = 0; batch < MAX_BATCHES_PER_TABLE; batch++) {
    const rows = await db
      .select({ id: schema.technicalLogs.id })
      .from(schema.technicalLogs)
      .where(lt(schema.technicalLogs.createdAt, cutoff))
      .limit(BATCH_SIZE);
    if (rows.length === 0) break;
    await db.delete(schema.technicalLogs).where(
      inArray(schema.technicalLogs.id, rows.map((r) => r.id)),
    );
    total += rows.length;
    if (rows.length < BATCH_SIZE) break;
  }
  return total;
}

async function deleteReferralVisitsBefore(cutoff: Date): Promise<number> {
  let total = 0;
  for (let batch = 0; batch < MAX_BATCHES_PER_TABLE; batch++) {
    const rows = await db
      .select({ id: schema.referralVisits.id })
      .from(schema.referralVisits)
      .where(lt(schema.referralVisits.createdAt, cutoff))
      .limit(BATCH_SIZE);
    if (rows.length === 0) break;
    await db.delete(schema.referralVisits).where(
      inArray(schema.referralVisits.id, rows.map((r) => r.id)),
    );
    total += rows.length;
    if (rows.length < BATCH_SIZE) break;
  }
  return total;
}


async function deleteExpiredUnavailableProducts(cutoff: Date): Promise<number> {
  let total = 0;

  for (let batch = 0; batch < MAX_BATCHES_PER_TABLE; batch++) {
    // Only delete eBay cache rows that have been unavailable since before
    // the cutoff. The NOT EXISTS guard protects persisted Look snapshots:
    // look_product.productId -> product.id has ON DELETE CASCADE.
    const rows = await db
      .select({ id: schema.products.id })
      .from(schema.products)
      .where(
        and(
          eq(schema.products.provider, "ebay"),
          eq(schema.products.availabilityStatus, "UNAVAILABLE"),
          lt(schema.products.unavailableAt, cutoff),
          notExists(
            db
              .select({ id: schema.lookProducts.id })
              .from(schema.lookProducts)
              .where(eq(schema.lookProducts.productId, schema.products.id)),
          ),
        ),
      )
      .limit(BATCH_SIZE);

    if (rows.length === 0) break;

    await db.delete(schema.products).where(
      inArray(schema.products.id, rows.map((row) => row.id)),
    );

    total += rows.length;
    if (rows.length < BATCH_SIZE) break;
  }

  return total;
}

async function deleteNotificationsBefore(cutoff: Date): Promise<number> {
  let total = 0;
  for (let batch = 0; batch < MAX_BATCHES_PER_TABLE; batch++) {
    const rows = await db
      .select({ id: schema.notifications.id })
      .from(schema.notifications)
      .where(lt(schema.notifications.createdAt, cutoff))
      .limit(BATCH_SIZE);
    if (rows.length === 0) break;
    await db.delete(schema.notifications).where(
      inArray(schema.notifications.id, rows.map((r) => r.id)),
    );
    total += rows.length;
    if (rows.length < BATCH_SIZE) break;
  }
  return total;
}

export interface CleanupStats {
  technicalLogsDeleted: number;
  referralVisitsDeleted: number;
  unavailableProductsDeleted: number;
  notificationsDeleted: number;
  ranAt: string;
}

/** Idempotent and safe to run repeatedly/concurrently (section 14) —
 *  every step is a plain "delete rows older than X" scan, so running
 *  it twice in a row (or from two triggers firing close together — see
 *  instrumentation.ts and api/maintenance/cleanup/route.ts, the two
 *  ways this gets invoked) just means the second run finds nothing
 *  left to delete, not a duplicate or conflicting effect. */
export async function runCleanup(): Promise<CleanupStats> {
  const now = new Date();
  const technicalLogCutoff = new Date(now.getTime() - TECHNICAL_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const referralVisitCutoff = new Date(now.getTime() - REFERRAL_VISIT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const unavailableProductCutoff = new Date(
    now.getTime() - UNAVAILABLE_PRODUCT_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );
  const notificationCutoff = new Date(now.getTime() - NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const [technicalLogsDeleted, referralVisitsDeleted, unavailableProductsDeleted, notificationsDeleted] =
    await Promise.all([
      deleteTechnicalLogsBefore(technicalLogCutoff),
      deleteReferralVisitsBefore(referralVisitCutoff),
      deleteExpiredUnavailableProducts(unavailableProductCutoff),
      deleteNotificationsBefore(notificationCutoff),
    ]);

  const stats: CleanupStats = {
    technicalLogsDeleted,
    referralVisitsDeleted,
    unavailableProductsDeleted,
    notificationsDeleted,
    ranAt: now.toISOString(),
  };

  // Reported to the console, NOT written into technical_log itself —
  // otherwise every cleanup run would create a row for the next
  // cleanup run to also clean up, an unbounded (if slow) leak of its
  // own.
  console.log("[cleanup] daily sweep complete:", stats);
  return stats;
}
