import type { CacheAdapter, CacheOptions } from "./cache-types.js";
import { InMemoryCache } from "./in-memory-cache.js";

export const CACHE_DEFAULT_TTL_MS = 5 * 60 * 1000;
export const CACHE_FETCH_TTL_MS = 10 * 60 * 1000;
export const CACHE_SEARCH_TTL_MS = 3 * 60 * 1000;
export const CACHE_GRAPH_REPORT_TTL_MS = 15 * 60 * 1000;

let adapter: CacheAdapter;
let _enabled: boolean;

function initCacheOnce(): void {
  if (adapter !== undefined) return;
  _enabled = process.env.SCOUT_CACHE_ENABLED !== "false";
  adapter = new InMemoryCache();
}

export function initCache(options?: Partial<CacheOptions>): void {
  const opts: CacheOptions = {
    enabled: process.env.SCOUT_CACHE_ENABLED !== "false",
    defaultTtlMs: CACHE_DEFAULT_TTL_MS,
    ...options,
  };
  _enabled = opts.enabled;
  adapter = opts.adapter ?? new InMemoryCache();
}

export function isCacheEnabled(): boolean {
  initCacheOnce();
  return _enabled;
}

export function getCacheAdapter(): CacheAdapter {
  initCacheOnce();
  return adapter;
}

export async function cacheGet<T>(key: string): Promise<{ found: boolean; value?: T }> {
  initCacheOnce();
  if (!_enabled) return { found: false };
  const value = await adapter.get<T>(key);
  return value !== undefined ? { found: true, value } : { found: false };
}

export async function cacheSet<T>(key: string, value: T, ttlMs?: number): Promise<void> {
  initCacheOnce();
  if (!_enabled) return;
  await adapter.set(key, value, ttlMs ?? CACHE_DEFAULT_TTL_MS);
}

export async function cacheDel(key: string): Promise<void> {
  initCacheOnce();
  if (!_enabled) return;
  await adapter.del(key);
}

export async function cacheClear(): Promise<void> {
  initCacheOnce();
  await adapter.clear();
}

export async function cacheWrap<T>(
  key: string,
  fetch: () => Promise<T>,
  ttlMs?: number,
): Promise<{ value: T; cacheHit: boolean }> {
  const cached = await cacheGet<T>(key);
  if (cached.found && cached.value !== undefined) {
    return { value: cached.value, cacheHit: true };
  }
  const value = await fetch();
  await cacheSet(key, value, ttlMs);
  return { value, cacheHit: false };
}

export { type CacheAdapter, type CacheStats, type CacheEntry } from "./cache-types.js";
