import "server-only";
import type { BucketedPool, BucketOffsets } from "@/types/explore";
import { TtlCache } from "@/lib/recommendation/cache";

// One assembled+ranked+diversified feed pool, generated once per
// candidate-generation pass and paged through by cursor rather than
// re-running the whole pipeline (and re-hitting eBay) on every scroll
// tick. Partitioned by classification (familiar/adjacent/exploration)
// so mixSelector can page each bucket independently — see
// selectMixedPage in mixSelector.ts. Small in-memory footprint: a pool
// is at most a few dozen look-cards. TTL keeps memory bounded across a
// long dev session.
const pools = new TtlCache<BucketedPool>(10 * 60_000);
const shownBySession = new TtlCache<string[]>(30 * 60_000);
// Sellers (product.seller.username) already shown this session — a
// parallel structure to shownBySession, same TTL/lifecycle. Section:
// "do not show more than 1 item from the one seller" — every eBay
// listing carries a seller, so this is the same session-scoped
// exclusion mechanism as product ids, just keyed on seller instead.
const shownSellersBySession = new TtlCache<string[]>(30 * 60_000);
// How many times this session has generated a fresh candidate pool
// (first pool = generation 0 for an explicitly reset session).
// candidateSource.ts turns this into an eBay result offset, so a
// regenerated pool asks eBay for the *next* page of matching items
// instead of re-requesting the same top-20 — see nextPoolGeneration.
const poolGenerationBySession = new TtlCache<number>(30 * 60_000);

// A brand-new session always used to start its very first pool at
// generation 0 -> eBay offset 0, i.e. the same deterministic top
// results for the same deterministic generation-0 query set (see
// buildCandidateQueries's "generation 0 is deterministic" guarantee)
// every single time. Since a full page reload now gets a genuinely
// new sessionId (fresh Explore session, see session.tsx), that made
// "reload -> fresh feed" show the *same* offers as before the reload,
// not new ones. Randomizing where a brand-new session starts (rather
// than each individual generation's queries, which stay deterministic
// -- that's what keeps a single session's own regenerations
// cache-friendly and testable) fixes that. Capped well under
// computeEbayOffset's own 20-generation ceiling so a session still has
// plenty of room to page deeper via normal infinite scroll before the
// recycle fallback would ever engage.
const STARTING_GENERATION_SPREAD = 10;

export function nextPoolGeneration(sessionId: string): number {
  const current = poolGenerationBySession.get(sessionId);
  if (current === undefined) {
    const start = Math.floor(Math.random() * STARTING_GENERATION_SPREAD);
    poolGenerationBySession.set(sessionId, start + 1);
    return start;
  }
  poolGenerationBySession.set(sessionId, current + 1);
  return current;
}

export function storePool(poolId: string, pool: BucketedPool) {
  pools.set(poolId, pool);
}

export function getPool(poolId: string): BucketedPool | undefined {
  return pools.get(poolId);
}

// Deliberately small: only what's needed to resume paging through a
// cached pool. Product ids the session has already seen are NOT
// carried here — they live server-side in shownBySession (below) and
// are looked up by sessionId on every request instead. Putting the
// ever-growing shown-id list in the cursor was the cause of cursors
// eventually exceeding the query-param size limit (400
// invalid_request) after enough pages/scrolling.
export interface ExploreCursor {
  poolId: string;
  offsets: BucketOffsets;
}

export function encodeCursor(cursor: ExploreCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf-8").toString("base64url");
}

export function getShownIds(sessionId: string): string[] {
  return shownBySession.get(sessionId) ?? [];
}

export function addShownIds(sessionId: string, ids: string[]): void {
  if (!sessionId || ids.length === 0) return;
  const current = new Set(shownBySession.get(sessionId) ?? []);
  for (const id of ids) {
    if (id) current.add(id);
  }
  shownBySession.set(sessionId, [...current]);
}

export function resetShownIds(sessionId: string): void {
  if (sessionId) shownBySession.set(sessionId, []);
}

export function getShownSellers(sessionId: string): string[] {
  return shownSellersBySession.get(sessionId) ?? [];
}

export function addShownSellers(sessionId: string, sellers: string[]): void {
  if (!sessionId || sellers.length === 0) return;
  const current = new Set(shownSellersBySession.get(sessionId) ?? []);
  for (const seller of sellers) {
    if (seller) current.add(seller);
  }
  shownSellersBySession.set(sessionId, [...current]);
}

export function resetShownSellers(sessionId: string): void {
  if (sessionId) shownSellersBySession.set(sessionId, []);
}

export function resetPoolGeneration(sessionId: string): void {
  if (sessionId) poolGenerationBySession.set(sessionId, 0);
}

export function decodeCursor(raw: string | null): ExploreCursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf-8"));
    if (
      typeof parsed?.poolId === "string" &&
      parsed?.offsets &&
      typeof parsed.offsets.familiar === "number" &&
      typeof parsed.offsets.adjacent === "number" &&
      typeof parsed.offsets.exploration === "number"
    ) {
      // Ignore any other fields an older/foreign cursor might carry
      // (e.g. a pre-fix cursor that still has excludeIds) — only the
      // two fields we use are trusted.
      return { poolId: parsed.poolId, offsets: parsed.offsets as BucketOffsets };
    }
    return null;
  } catch {
    return null;
  }
}

export function createPoolId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `pool-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
