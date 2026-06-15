# PR 2: phase1-research-perf-reranker → phase1-eval-router

**Title:** Phase 1.5: Harness v2, research relevance, and fast paths

## Summary

Research orchestrator performance improvements, source relevance gate, harness v2 (trajectory analysis, reward function), repo cleanup, and deterministic coding fast paths. Stacked on `phase1-eval-router`.

## Commits (6 unique on top of phase1-eval-router)

| Commit | Description |
|--------|-------------|
| `4743964` | ResearchOrchestrator performance: fast mode, timing trace, evidence reranker, concurrent crawl |
| `2a7d6d5` | Add harness trajectory analysis |
| `195f58e` | Add source relevance gate + re-calibrate reward |
| `b9f427a` | Official-source search planning + generic news planner + API synthesis template |
| `aae803f` | Add reverse linked list question handling and coding timeout configuration |
| `25a87a6` | Clean repo structure around harness and docs |
| `5ca3eb6` | Remove stale root-level files (TODO, plan, old Python scripts) |

## Key changes

### Research performance
- Fast mode (env `RESEARCH_FAST_MODE=1`): fewer news queries, reduced topK, skip document ingestion
- Timing trace in research responses for debugging
- Evidence reranker with source quality scoring
- Concurrent crawling

### Source relevance gate
- Filters crawled pages by content quality before evidence extraction
- Rejects navigation-heavy, blocked, and tiny pages

### Harness v2
- `harness-trajectory.mjs` — per-case timing and tool trace
- `harness-reward.mjs` — reward computation (routing, coverage, latency, grounding)
- `analyze-run.mjs` — post-run analysis with failure categorization

### Coding fast paths
- Deterministic reverse-linked-list answer (no model call, instant)
- Configurable coding model timeout (env `ROUTER_CODING_TIMEOUT_MS`)

### Repo structure cleanup
- `benchmarks/` → `harness/`
- `benchmark-runs/` → `harness-runs/`
- Lessons merged into `docs/LESSONS.md`
- `tasks/` removed
- Package scripts: `harness:eval`, `harness:ci`, `harness:analyze`, `harness:research` (with backward-compat aliases)

## Full eval result

```text
Passed: 10/10
Mean reward: 6.0
Routing accuracy: 100%
Mean correctness: 1.0
Mean completeness: 1.0
```

## PR 1 (base)

Base: `main` → Head: `phase1-eval-router`

Contains the router, critic, and eval harness foundation.

---

_To create: `gh pr create --base phase1-eval-router --head phase1-research-perf-reranker --title "Phase 1.5: Harness v2, research relevance, and fast paths" --body "$(cat PR-2-phase1-research-perf-reranker.md)"`_
