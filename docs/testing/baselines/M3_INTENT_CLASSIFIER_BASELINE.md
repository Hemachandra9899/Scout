# M3 Unified Intent Classifier Baseline

## Goal

Create one typed source of truth for Scout routing.

## Commits

| Commit | SHA | Purpose |
|--------|-----|---------|
| 1 | 39f4dac | Unified deterministic classifier with typed intents and routeIntentToDecision |
| 2 | 6ca58ed | Optional LLM classifier fallback (disabled by default) |
| 3 | (this) | Cleanup runtime detector comments + baseline doc |

## Env

```
FIRECRAWL_ENABLED=false
RESEARCH_PARALLELISM=4
FOCUSED_RETRY_MAX_RESOURCES=4
FOCUSED_RETRY_TIMEOUT_MS=45000
ROUTER_LLM_INTENT_ENABLED=false
```

## Results

| Suite               | Result |
| ------------------- | -----: |
| typecheck:api       |   pass |
| typecheck:knowledge |   pass |
| typecheck:web       |   pass |
| eval:ci             |  10/10 |
| eval:phase2         |    7/7 |
| eval:phase3         |    8/8 |
| eval:routing-intent |   17/17 |

## Debug

`debug.routing` now comes from the unified classifier.

Example:

```json
{
  "intent": "web_research",
  "tool": "web_research",
  "tier": 2,
  "confidence": 0.82,
  "signals": ["fresh_or_external_research"],
  "analysisAngles": ["compare Google Ads API and Meta Marketing API"],
  "reason": "Research/current/API/comparison query; use ResearchOrchestrator.",
  "source": "deterministic"
}
```

## Notes

- LLM intent classifier is default off (`ROUTER_LLM_INTENT_ENABLED=false`).
- Bad JSON, timeout, or model failure falls back to deterministic routing.
- API router source of truth is `packages/knowledge/src/router/intent-classifier.ts`.
- RLM runtime still has its own `intentDetector.ts` / `fastIntentDetector.ts` (runtime-local; not API router source of truth).
- Removed duplicate `shouldUseProjectGraphContext` from router.service.ts (moved to classifier).
