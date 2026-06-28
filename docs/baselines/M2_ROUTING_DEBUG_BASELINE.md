# M2: Routing Debug Signal Baseline

## Goal
Ensure every response block in `router.service.ts` attaches a `routing` debug object so eval harnesses can observe which route was chosen, why, and with what confidence.

## Changes

### 1. `routeDebug()` helper
- Refactored from inline `routeScoutQuery` call to a reusable helper at `router.service.ts:603`.
- Returns `{ intent, confidence, signals, source, reason, analysisAngles }`.

### 2. Debug blocks updated (6 locations)
| Location | Function | Type |
|---|---|---|
| `deterministicNoEvidenceResponse` (line ~520) | Standalone | `routeDebug(input.query)` |
| `answerReverseLinkedListQuestion` (line ~775) | Standalone | `routeDebug(query)` |
| `partialResearchTimeoutResponse` (line ~936) | Standalone | `routeDebug(query)` |
| `search_kb` no-results return (line ~1425) | Inside `answerWithRouter` | `routing: routingDebug` |
| `search_kb` results return (line ~1537) | Inside `answerWithRouter` | `routing: routingDebug` (pre-existing) |
| All other routes | Inside `answerWithRouter` | `routing: routingDebug` (pre-existing) |

### 3. Harness extraction (3 files)
- `run-eval.mjs`: extracts `routingIntent`, `routingConfidence`, `routeSignals`, `routeReason`, `routeSource`, `analysisAngles`
- `harness-trajectory.mjs`: same fields
- `analyze-run.mjs`: aggregates `routingIntents` and `routeSources` across trajectories

### 4. `answerReverseLinkedListQuestion` signature
- Added `query: string` parameter so `routeDebug(query)` can be called internally.

## Verification
- `npm run typecheck:api` — pass
- `npm run typecheck:knowledge` — pass
- `npm run typecheck:web` — pass
- `npm run eval:phase2` — 6/7 pass (1 pre-existing routing flake: `phase2-memo-repo-followup-001` expects `search_kb` but gets `web_research` — unrelated)

## Signal flow
```
query → classifyRouteIntent(query) → { intent, confidence, signals, analysisAngles }
  → routeDebug(query) / routingDebug → { intent, confidence, signals, source, reason, analysisAngles }
  → debug.routing in response
  → harness extraction → trajectory phase2 fields
  → analyze-run.mjs aggregation
```
