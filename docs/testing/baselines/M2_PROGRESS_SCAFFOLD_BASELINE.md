# M2.4 Progress / Streaming Scaffold Baseline

## Goal

Add typed progress events for research runs without changing answer quality.

## Env

```bash
FIRECRAWL_ENABLED=false
RESEARCH_PARALLELISM=4
FOCUSED_RETRY_MAX_RESOURCES=4
FOCUSED_RETRY_TIMEOUT_MS=45000
```

## Before

| Suite               | Pass rate |
| ------------------- | --------: |
| eval:ci             |     10/10 |
| eval:phase2         |       7/7 |
| eval:phase3         |       8/8 |
| eval:routing-intent |     17/17 |

## After

| Suite               | Pass rate |
| ------------------- | --------: |
| eval:ci             |     10/10 |
| eval:phase2         |       7/7 |
| eval:phase3         |       8/8 |
| eval:routing-intent |     17/17 |

## Debug Added

```ts
debug.progress = {
  eventCount,
  stages,
  events
}
```

ResearchOrchestrator now supports:

```ts
onProgress?: ScoutProgressSink
```

## Result

All gates green. Progress events are emitted at major research stages (planning, provider_search, crawl, evidence, synthesis). Orchestrator emits `progress` in its debug output. Router collects events via `onProgress` and includes `progress` + `focusedRetryProgress` in its debug. Harness extracts `progressEventCount` and `progressStages` signals. No answer quality change.
