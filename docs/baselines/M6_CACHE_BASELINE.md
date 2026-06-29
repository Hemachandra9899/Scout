# M6 Cache Baseline

**Date**: 2026-06-29

## Summary

Introduced a unified caching layer at `packages/knowledge/src/cache/` with four insertion points: URL fetch, provider search, graph report reads, and official source fetches (via `fetchUrlText` which now caches internally).

## Cache Architecture

- **`cache-types.ts`** — `CacheAdapter` interface, `CacheEntry`, `CacheStats`, `CacheOptions`
- **`cache-key.ts`** — Key generation via SHA-256 of concatenated parts; separate helpers for each surface (`fetchUrlCacheKey`, `searchCacheKey`, `graphReportCacheKey`)
- **`in-memory-cache.ts`** — `Map`-based with TTL expiry; tracks hit/miss stats
- **`cache-manager.ts`** — Facade: `initCache()`, `cacheWrap()`, `cacheGet/set/del/clear`, env guard `SCOUT_CACHE_ENABLED` (default true)
- **`index.ts`** — Re-exports all public symbols

### TTLs
| Surface | TTL |
|---|---|
| Default | 5 min |
| URL fetch (`fetchUrlText`) | 10 min |
| Provider search | 3 min |
| Graph report (DB) | 15 min |

## Insertion Points

### 1. `packages/knowledge/src/research/local-fetch.ts`
`fetchUrlText` wraps its fetch call with `cacheWrap`; returns `cacheHit` boolean on the result object.

### 2. `packages/knowledge/src/research/search-provider.ts`
Extracted provider execution into `executeProviderSearch` and wrapped it with `cacheWrap` keyed on `(query, limit, routeKind)`. The `searchTrace` metadata includes `cacheHit` boolean for debug visibility.

### 3. `packages/knowledge/src/research/crawl-manager.ts`
Covered transitively: the `fetchUrlText` fallback for official docs (line 334) calls the now-cached `fetchUrlText`.

### 4. `apps/api/src/modules/graph-reports/graph-reports.service.ts`
`getLatestGraphReport` and `getGraphReportById` wrap their Prisma queries with `cacheWrap`.

## Debug / Harness Signals

New signals in `debug.cache`:
- `enabled` — whether SCOUT_CACHE_ENABLED is true
- `searchCacheHit` — true if any planned resource metadata shows a cache hit
- `fetchCacheHit` — reserved for future fetch-level tracking

New harness signals (phase2):
- `cacheEnabled`
- `searchCacheHit`
- `fetchCacheHit`

## Files Changed
- Added `packages/knowledge/src/cache/` (5 new files)
- Modified `packages/knowledge/src/research/local-fetch.ts` — cache wrap
- Modified `packages/knowledge/src/research/search-provider.ts` — cache wrap
- Modified `apps/api/src/modules/graph-reports/graph-reports.service.ts` — cache wrap
- Modified `apps/api/src/modules/tools/research-response-contract.ts` — `debug.cache` field
- Modified `packages/knowledge/package.json` — cache exports
- Modified `packages/knowledge/src/index.ts` — cache re-export
- Modified `harness/eval/run-eval.mjs` — cache signals extraction
- Modified `harness/eval/harness-trajectory.mjs` — cache signals extraction
- Modified `harness/eval/analyze-run.mjs` — cache signal aggregation

## Future Work
- Wire `fetchCacheHit` into the response debug (propagate from `fetchUrlText` through crawl-manager to research orchestrator debug)
- Redis adapter (`packages/knowledge/src/cache/redis-cache.ts`) using existing `ioredis` client from `packages/queue`
- Add `cacheHit`/`cacheMiss` tracking to individual provider calls (deeper integration in `executeProviderSearch`)
