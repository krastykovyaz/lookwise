import "server-only";

// A plain in-memory TTL cache. Explicitly not Redis (section 18: "Do not
// introduce Redis yet") — this resets on server restart and isn't shared
// across processes, which is fine for a single dev/small-deployment
// instance. Two instances are used: one for raw eBay query results
// (candidateSource.ts) and one for whole assembled feed pools (pool.ts).
export class TtlCache<T> {
  private store = new Map<string, { value: T; expiresAt: number }>();

  constructor(private ttlMs: number) {}

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T) {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    // Best-effort cap so a long-running dev server doesn't grow forever.
    if (this.store.size > 500) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) this.store.delete(oldestKey);
    }
  }
}
