export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  createdAt: number;
  hits: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
}

export interface CacheAdapter {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlMs: number): Promise<void>;
  del(key: string): Promise<void>;
  clear(): Promise<void>;
  stats(): CacheStats;
}

export interface CacheOptions {
  enabled: boolean;
  defaultTtlMs: number;
  adapter?: CacheAdapter;
}
