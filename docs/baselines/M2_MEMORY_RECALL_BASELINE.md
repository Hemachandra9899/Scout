# M2.2 Lazy Memory Recall Baseline

## Goal

Reduce router latency by avoiding unnecessary memory recall and running setup writes only when needed.

## Env

```bash
FIRECRAWL_ENABLED=false
RESEARCH_PARALLELISM=4
```

## Before

| Suite               | Pass rate | Notes       |
| ------------------- | --------: | ----------- |
| eval:ci             |     10/10 | Before M2.2 |
| eval:phase2         |       7/7 | Before M2.2 |
| eval:phase3         |       8/8 | Before M2.2 |
| eval:routing-intent |     16/16 | Before M2.2 |

## After

| Suite               | Pass rate | Notes      |
| ------------------- | --------: | ---------- |
| eval:ci             |     10/10 |            |
| eval:phase2         |       7/7 |            |
| eval:phase3         |       8/8 |            |
| eval:routing-intent |     16/16 |            |

## Changes

M2.2 refactors `answerWithRouter()` in `router.service.ts`:

1. **Route first** — `routeScoutQuery()` is called before any memory work.
2. **`routeNeedsMemory()`** — determines whether the selected route needs memory recall:
   - `web_research` and `search_kb`: always need memory (preferences, source quality, blocked sources).
   - `github_repo`: only if query includes repo-memory signals (e.g., "this repo", "repository", "modules").
   - `direct_model`: only if query includes preference/style signals.
   - `query_graph`: only if query explicitly references remembered/memoized repos.
   - `sandbox`: never needs memory.
3. **`getMemoryForRoute()`** — runs setup writes + recall with timing instrumentation, or returns empty/skipped if not needed.
4. **Lazy promise pattern** — memory promise is started immediately after routing but only awaited when the branch needs it:
   - `search_kb`: awaited early for `memoryContext` injection into prompts.
   - `direct_model` (non-fast-path): awaited early for `memoryContext` injection into coding query.
   - All other branches: awaited at the return point for debug output only.
5. **`memoryTiming` debug field** — added to every response with lazy flag, skip reason, setup/recall timing.

## Routes that skip memory

- `direct_model` with pure code queries (reverse linked list, code comparison)
- `sandbox` (simple list computation, rlm-runtime computation)
- `query_graph` for graph report generation
- `query_graph` for pure repo graph queries (unless query explicitly mentions remembered repo)
- `github_repo` for first-time repo analysis (not a follow-up/remembered repo query)

## Routes that still require memory

- `web_research` — for source quality, blocked source avoidance, preference-based ranking
- `search_kb` — for preference context, durable facts, source reuse
- `github_repo` — when query includes repo-memory signals (follow-up queries about a remembered repo)
- `direct_model` — when query includes preference/style signals
- Any route with `setupMessages` — setup memories are always written

## Debug

M2.2 adds:

```ts
debug.memoryTiming = {
  lazy: true,
  routeNeedsMemory: boolean,
  skipped: boolean,
  setupWriteMs: number,
  recallMs: number,
  reason: string,
}
```

## Result

All gates pass with no regressions. Memory behavior is preserved for routes that depend on it. Routes that never use memory (sandbox, direct_model pure code, query_graph pure graph) skip recall entirely.
