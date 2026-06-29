import type { CacheAdapter, CacheEntry, CacheStats } from "./cache-types.js";

export class InMemoryCache implements CacheAdapter {
  private store = new Map<string, CacheEntry<unknown>>();
  private _hits = 0;
  private _misses = 0;

  async get<T>(key: string): Promise<T | undefined> {
    const entry = this.store.get(key);
    if (!entry) {
      this._misses++;
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this._misses++;
      return undefined;
    }
    entry.hits++;
    this._hits++;
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
      createdAt: Date.now(),
      hits: 0,
    });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  async clear(): Promise<void> {
    this.store.clear();
    this._hits = 0;
    this._misses = 0;
  }

  stats(): CacheStats {
    this.evictExpired();
    return { hits: this._hits, misses: this._misses, size: this.store.size };
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) this.store.delete(key);
    }
  }
}
