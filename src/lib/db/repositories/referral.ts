import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { REFERRAL_CODE_ALPHABET, REFERRAL_CODE_LENGTH } from "@/lib/referral/cookies";

const MAX_GENERATION_ATTEMPTS = 5;

function randomCode(): string {
  let out = "";
  for (let i = 0; i < REFERRAL_CODE_LENGTH; i++) {
    out += REFERRAL_CODE_ALPHABET[Math.floor(Math.random() * REFERRAL_CODE_ALPHABET.length)];
  }
  return out;
}

/** Returns the user's public referral code, generating and persisting
 *  one on first use if they don't have one yet (existing users
 *  predate this column; new users get one at signup — see
 *  auth.ts's events.createUser — but this stays safe to call from
 *  anywhere as a fallback). Collision-retries a few times against the
 *  unique index rather than pre-checking-then-inserting. */
export async function ensureReferralCode(userId: string): Promise<string> {
  const [existing] = await db
    .select({ referralCode: schema.users.referralCode })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  if (existing?.referralCode) return existing.referralCode;

  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
    const code = randomCode();
    try {
      await db.update(schema.users).set({ referralCode: code }).where(eq(schema.users.id, userId));
      return code;
    } catch {
      // Unique constraint collision (astronomically unlikely at this
      // alphabet/length, but cheap to retry) — try another code.
    }
  }
  throw new Error("Could not generate a unique referral code.");
}

export async function getUserIdByReferralCode(code: string): Promise<string | null> {
  const [row] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.referralCode, code));
  return row?.id ?? null;
}

export type ReferralSourceType = "look" | "item";

/** Logs an anonymous click on a ?ref= link. Best-effort, insert-only —
 *  this is click analytics, not the attribution relationship itself
 *  (see createReferralIfAbsent), so it's fine to log every visit
 *  including repeats. */
export async function recordReferralVisit(input: {
  referralCode: string;
  sourceType: ReferralSourceType;
  sourceId: string;
  visitorId?: string | null;
}) {
  await db.insert(schema.referralVisits).values({
    referralCode: input.referralCode,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    visitorId: input.visitorId ?? null,
  });
}

/** Creates the referrer<->referred relationship exactly once per
 *  referred user (idempotent via the unique index on referredUserId —
 *  onConflictDoNothing, not a check-then-insert race). No-op if the
 *  user would be referring themselves. */
export async function createReferralIfAbsent(input: {
  referrerUserId: string;
  referredUserId: string;
  sourceType?: ReferralSourceType | null;
  sourceId?: string | null;
}) {
  if (input.referrerUserId === input.referredUserId) return;
  await db
    .insert(schema.referrals)
    .values({
      referrerUserId: input.referrerUserId,
      referredUserId: input.referredUserId,
      sourceType: input.sourceType ?? null,
      sourceId: input.sourceId ?? null,
    })
    .onConflictDoNothing({ target: schema.referrals.referredUserId });
}
