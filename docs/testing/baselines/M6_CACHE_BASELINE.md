# M6 Cache Baseline

**Date**: 2026-06-29

**Commit**: (to be filled after commit)

## Gate Results

### Typechecks (all pass)
- `typecheck:api` — PASS
- `typecheck:knowledge` — PASS
- `typecheck:web` — PASS

### Evals (SCOUT_CACHE_ENABLED=true)
| Gate | Result |
|---|---|
| `eval:ci` | 10/10 passed, mean reward 6.0, routing 100% |
| `eval:phase2` | 7/7 passed, mean reward 6.0, routing 100% |
| `eval:phase3` | 8/8 passed, mean reward 6.0, routing 100% |
| `eval:routing-intent` | 17/17 passed, mean reward 6.0, routing 100% |

## Smoke Test

Query: "What is the latest important WhatsApp news?"

| Run | `searchCacheHit` | Confidence | Status | Evidence |
|---|---|---|---|---|
| Run 1 (cold cache) | `false` | 0.94 | answered | 8 |
| Run 2 (warm cache) | `true` | 0.94 | answered | 8 |

**Cache hit confirmed**: second run returns `searchCacheHit: true`. Answer quality unchanged.

## Summary

Introduced a unified caching layer at `packages/knowledge/src/cache/` with four insertion points: URL fetch, provider search, graph report reads, and official source fetches (via `fetchUrlText` which now caches internally).

## Cache Architecture

- **`cache-types.ts`** — `CacheAdapter` interface, `CacheEntry`, `CacheStats`, `CacheOptions`
- **`cache-key.ts`** — Key generation via SHA-256 of concatenated parts; separate helpers for each surface (`fetchUrlCacheKey`, `searchCacheKey`, `graphReportCacheKey`)
- **`in-memory-cache.ts`** — `Map`-based with TTL expiry; tracks hit/miss stats
- **`cache-manager.ts`** — Facade: `initCache()`, `cacheWrap()`, `cacheGet/set/del/clear`, eager lazy init via `initCacheOnce()`, env guard `SCOUT_CACHE_ENABLED` (default true)
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
Covered transitively: the `fetchUrlText` fallback for official docs calls the now-cached `fetchUrlText`.

### 4. `apps/api/src/modules/graph-reports/graph-reports.service.ts`
`getLatestGraphReport` and `getGraphReportById` wrap their Prisma queries with `cacheWrap`.

## Debug / Harness Signals

New signals in `debug.cache`:
- `enabled` — whether SCOUT_CACHE_ENABLED is true
- `searchCacheHit` — true if any search-trace metadata shows a cache hit
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
- Modified `packages/knowledge/src/cache/cache-manager.ts` — fixed eager init
- Modified `harness/eval/run-eval.mjs` — cache signals extraction
- Modified `harness/eval/harness-trajectory.mjs` — cache signals extraction
- Modified `harness/eval/analyze-run.mjs` — cache signal aggregation

## Known Risks
- **In-memory cache resets on process restart** — no persistence. Acceptable for dev; production should use Redis adapter.
- **No Redis adapter yet** — deferred to a follow-up. Existing `ioredis` client in `packages/queue/src/redis.connection.ts` can be reused.
- **Freshness-sensitive queries use short TTL** (3 min for provider search) — cold cache will still make live provider calls.
- **`fetchCacheHit` always false** — the signal propagates from `fetchUrlText` output but is not yet aggregated into the response contract. Future work.
- **Cache does not evict on DB writes** — graph report cache may serve stale data until TTL expiry.

## Future Work
- Redis adapter (`packages/knowledge/src/cache/redis-cache.ts`) using existing `ioredis` client from `packages/queue`
- Wire `fetchCacheHit` through the orchestrator debug pipeline
- Add `cacheHit`/`cacheMiss` tracking to individual provider calls
