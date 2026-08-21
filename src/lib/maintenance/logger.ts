import "server-only";
import { db, schema } from "@/lib/db/client";

/** Section 11: a place for ad hoc technical/debug events (an eBay API
 *  failure, an availability-check error, etc.) that's explicitly NOT
 *  meant to grow forever — see lib/maintenance/cleanup.ts, which is
 *  the only thing that ever deletes from this table. This is
 *  deliberately separate from console.error/console.log calls
 *  scattered through the app (those stay exactly as they are — this
 *  function is opt-in, for the cases where a technical event is worth
 *  querying later, not a replacement for normal server logging). Never
 *  throws — a failed log write must not break whatever it was logging
 *  about. */
export async function logTechnicalEvent(source: string, message: string): Promise<void> {
  try {
    await db.insert(schema.technicalLogs).values({ source, message });
  } catch (err) {
    console.error("[logTechnicalEvent] failed to write log row:", err);
  }
}
