# M4 Memory Curator Baseline

## Goal

Make Scout memory safer, deduped, and explainable.

## Design

- All memory writes go through `memory-curator.ts`.
- Non-curator code proposes memory only.
- Curator dedupes against DB and current batch using SHA-256 content hashes.
- Durable facts require source URLs.
- Memory recall is score-gated and capped.
- Memory context is labeled as context, not evidence.

## Env

```bash
FIRECRAWL_ENABLED=false
RESEARCH_PARALLELISM=4
FOCUSED_RETRY_MAX_RESOURCES=4
FOCUSED_RETRY_TIMEOUT_MS=45000
ROUTER_LLM_INTENT_ENABLED=false
MEMORY_RECALL_MIN_SCORE=0.2
MEMORY_RECALL_MAX_CONTEXT=8
```

## Results

| Suite               | Result |
| ------------------- | -----: |
| typecheck:api       |   PASS |
| typecheck:knowledge |   PASS |
| typecheck:web       |   PASS |
| eval:ci             |  10/10 |
| eval:phase2         |   7/7 |
| eval:phase3         |   8/8 |
| eval:routing-intent |  17/17 |

## Debug Added

```ts
debug.memoryCurator = {
  curatorUsed,
  proposedCount,
  writtenCount,
  skippedCount,
  skippedReasons
}

debug.memory.memoryCuratorUsed
debug.memory.memoryWrittenCount
debug.memory.memorySkippedCount

debug.memory.usedMemories[i] = {
  id,
  kind,
  scope,
  tier,
  score?,
  confidence,
  reason,
  text,
  sourceUrls
}
```

## Files Changed

- `packages/knowledge/src/memory/memory-curator.ts` (new)
- `packages/knowledge/src/memory/memory-manager.ts` (curator delegate, normalized scoring, recall gate)
- `apps/api/src/modules/router/router.service.ts` (categorized memory context, enriched debug, curator wire)
- `harness/eval/run-eval.mjs` (signal extraction)
- `harness/eval/harness-trajectory.mjs` (signal extraction)
- `harness/eval/analyze-run.mjs` (signal counting)

## Memory Tiers

| Tier       | Kinds mapped                                   |
| ---------- | ---------------------------------------------- |
| working    | (none currently)                               |
| episodic   | decision, task_trace, (default)                |
| semantic   | preference, durable_fact                       |
| procedural | source_quality, source_failure                 |

## Curator Gates

- Text < 8 chars → skip (too short)
- Text > 2000 chars → skip (too long)
- `durable_fact` without sourceUrls → skip (no provenance)
- Confidence < 0.45 → skip (below threshold)
- Duplicate content hash (DB or batch) → skip
- Dry-run mode for testing (no DB write)

## Curator Result

```ts
MemoryCuratorResult {
  proposedCount: number;
  writtenCount: number;
  skippedCount: number;
  decisions: MemoryCuratorDecision[];
  debug: {
    curatorUsed: true;
    proposedCount: number;
    writtenCount: number;
    skippedCount: number;
    writtenHashes: string[];
    skippedReasons: string[];
  };
}
```

## Notes

Memory remains context/ranking guidance. It is not evidence unless source URLs/provenance are attached.

The `filterAlreadyPersisted` and `dedupeDrafts` methods in `memory-manager.ts` remain for backwards compatibility but are no longer called by `addMany()` (curator handles deduplication internally).

Content hashes are stored in `metadata.contentHash` and `metadata.memoryHash` for future indexed lookups.
