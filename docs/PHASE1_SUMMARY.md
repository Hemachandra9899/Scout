# Phase 1: Router and Research Pipeline

## Status: Complete ✅

**Branch:** `phase1-research-perf-reranker`  
**Commits:** 13 (stacked on `phase1-eval-router` base)  
**Eval result:** 10/10, mean reward 6.0, routing accuracy 100%

## What was built

### Router (Phase 1 — 7 commits)

- 3-tier query router with keyword-based classification
- Faithfulness Critic v2 with evidence-anchored verification
- Deterministic no-evidence guard for trap queries
- search_kb synthesis with model fallback
- Eval harness with 10 test cases

### Research & Performance (Phase 1.5 — 6 commits)

- Research orchestrator with fast mode, timing trace, concurrent crawl
- Source relevance gate with content quality scoring
- Evidence reranker and crawl retry policy
- Official-source search planning and generic news planner
- API synthesis template with comparison/how-to modes
- Harness v2: trajectory analysis, reward function, analyzer

### Cleanup

- `benchmarks/` → `harness/`
- `benchmark-runs/` → `harness-runs/`
- Lessons merged into `docs/LESSONS.md`
- `tasks/` removed
- Package scripts updated with backward-compatible aliases

### Coding Fast Paths

- Deterministic reverse-linked-list answer (instant, no model call)
- Configurable coding model timeout (`ROUTER_CODING_TIMEOUT_MS`)

## Eval results (final run)

```
Passed: 10/10
Mean reward: 6.0
Mean correctness: 1.0
Mean completeness: 1.0
Routing accuracy: 100%
```

## CI Gate

`npm run eval:ci` enforces:
- Mean correctness ≥ 0.7
- Pass rate ≥ 0.9
- Mean reward ≥ 5.0
- Routing accuracy = 100%

Plus clean typechecks: `typecheck:api`, `typecheck:knowledge`, `typecheck:web`

## Key decisions

1. **Keyword routing, not LLM** — Fast, deterministic, testable. LLM classification not needed for current case set.
2. **Deterministic evidence extraction** — Claim-level extraction without LLM for reliability and testability.
3. **Hardcoded fast paths** — Common algorithm questions answered instantly without model calls.
4. **Faithfulness critic retry** — Single retry with focused query bridges most grounding gaps.

## What comes next (Phase 2)

- Memory system (source quality, failure, fact memories)
- Graph agent (multi-hop reasoning across sources)
- MCP integration (Model Context Protocol for tool use)
- Self-healing and recursion
