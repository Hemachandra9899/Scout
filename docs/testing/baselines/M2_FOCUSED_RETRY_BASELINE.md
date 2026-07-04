# M2.3 — Focused Retry Baseline

**Date**: 2026-06-28  
**Branch**: `phase3-repo-graphify`

## Summary

Replaced the full-budget retry in the web_research critic retry path with a **focused retry** policy. Instead of re-running with the full `ROUTER_RESEARCH_*` budget (which can fetch up to 20+ pages), the retry uses:

- `maxResources: 4`
- `maxPages: 4`
- `timeoutMs: 45000`
- `focused: true`

## What changed

- **Router service** (`apps/api/src/modules/router/router.service.ts`):
  - Added `FOCUSED_RETRY_MAX_RESOURCES = 4` and `FOCUSED_RETRY_TIMEOUT_MS = 45000` constants.
  - Added `shouldRunFocusedRetry()` — only retries if the critic returned "retry" and there are missing anchors, weak claims, or unsupported claims (or low supportedRatio).
  - Added `buildFocusedRetryQuery()` — builds a query string from the original query plus any missing/weak/unsupported anchors.
  - Added `claimToText()` — safely converts unknown claim types to string.
  - Replaced lines 1363–1395 (full retry block) with focused retry logic:
    - Only one retry attempt.
    - Budget capped at 4 resources / 4 pages / 45s timeout.
    - If retry score is not improved or not passed, original result is kept.
    - If retry throws, original result is preserved with debug flag.
  - Injected `focusedRetry` debug object into both return paths (critic-not-passed and normal).

- **Tools schema** (`apps/api/src/modules/tools/tools.schema.ts`): Extended `webResearchSchema` with `focused`, `maxResources`, `maxPages`, `timeoutMs`.

- **Tools service** (`apps/api/src/modules/tools/tools.service.ts`): Passes new fields through to `ResearchOrchestrator.run()`.

- **ResearchOrchestrator** (`packages/knowledge/src/research/research-orchestrator.ts`):
  - Extended `ResearchOrchestratorInput` with `focused`, `maxResources`, `maxPages`, `timeoutMs`.
  - When `focused: true`, caps `resourcesToCrawl` to `resourcesToCrawl.slice(0, maxResources)`.
  - Injects `focusedRetry` debug data into output.

- **Harness**:
  - `harness/eval/run-eval.mjs`: Extracts `focusedRetryUsed`, `focusedRetryMs` signals.
  - `harness/eval/harness-trajectory.mjs`: Extracts `focusedRetryUsed`, `focusedRetryMs` signals.
  - Added eval case `routing-focused-retry-api-001` to `routing-intent-cases/`.

## Baseline results

| Gate | Pass | Reward | Routing |
|------|------|--------|---------|
| eval:ci | 10/10 | 6.0 | 100% |
| eval:phase2 | 7/7 | 6.0 | 100% |
| eval:phase3 | 8/8 | 6.0 | 100% |
| eval:routing-intent | 17/17 | 6.0 | 100% |

## Next

M2.4 — progress/streaming scaffold or M2.5 — direct_model improve.
