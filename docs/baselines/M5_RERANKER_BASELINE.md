# M5 Hybrid Retrieval + Reranker Baseline

## Goal

Improve candidate ordering for evidence, memory, and repo graph query results.

## Design

- Unified reranker interface under `packages/knowledge/src/rerank`
- Deterministic reranker enabled by default
- Optional LLM reranker behind `RERANKER_LLM_ENABLED=false`
- Surfaces:
  - evidence
  - memory
  - repo_graph
  - kb/source later

## Env

```bash
FIRECRAWL_ENABLED=false
RESEARCH_PARALLELISM=4
FOCUSED_RETRY_MAX_RESOURCES=4
FOCUSED_RETRY_TIMEOUT_MS=45000
ROUTER_LLM_INTENT_ENABLED=false
RERANKER_LLM_ENABLED=false
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

## Debug

```ts
debug.rerank = {
  rerankerUsed,
  rerankerKind,
  surface,
  inputCount,
  outputCount,
  topK,
  reasons
}
```

## Scoring Formula

```
finalScore = lexicalScore * 0.55
           + boundedBaseScore * 0.2
           + titleBoost
           + sourceScore
           + freshnessBoost
           + surfaceBoost
```

### Factors
- **lexicalScore** (0-1): Token overlap ratio between query and candidate text + full-phrase boost
- **baseScore** (0-1): Normalized from caller-provided score/confidence
- **titleBoost**: lexicalScore(query, title) * 0.15
- **sourceScore**: official docs (+0.18), docs/developers domain (+0.14), GitHub (+0.08), community (-0.03)
- **freshnessBoost**: ≤14 days (+0.08), ≤90 days (+0.04), >2 years (-0.04)
- **surfaceBoost**: Memory kind boosts (source_quality +0.14, source_failure -0.2, preference +0.08, durable_fact +0.1); repo_graph type boosts (file +0.08, symbol +0.06, service +0.05)

## Files

### New
- `packages/knowledge/src/rerank/reranker-types.ts` — RerankSurface, RerankCandidate, RerankResult, RerankInput, RerankDebug
- `packages/knowledge/src/rerank/deterministic-reranker.ts` — Lexical-overlap deterministic reranker
- `packages/knowledge/src/rerank/llm-reranker.ts` — Optional LLM reranker with deterministic fallback
- `packages/knowledge/src/rerank/index.ts` — Re-exports
- `packages/knowledge/src/research/evidence-reranker.ts` — Evidence surface adapter with `RERANKER_ENABLED` guard
- `docs/baselines/M5_RERANKER_BASELINE.md`

### Modified
- `packages/knowledge/package.json` — Added rerank exports
- `packages/knowledge/src/research/research-orchestrator.ts` — Calls `rerankEvidenceForQuery` after crawl
- `packages/knowledge/src/memory/memory-manager.ts` — Uses `deterministicRerank` in `search()` with `surface: "memory"`
- `packages/knowledge/src/graph/repo-graph-query.ts` — Uses `deterministicRerank` for entity ranking
- `harness/eval/run-eval.mjs` — Added `rerankerUsed`, `rerankerKind`, `rerankedCount` signals
- `harness/eval/harness-trajectory.mjs` — Same signals
- `harness/eval/analyze-run.mjs` — Added `rerankerUsed` to phase2 counts

## Notes

The default reranker is deterministic and dependency-free. LLM reranking is available but disabled and not wired to a model caller.

This is a **hybrid deterministic reranking scaffold**. True embedding/cross-encoder reranking can be plugged into the existing interface without changing call sites.
