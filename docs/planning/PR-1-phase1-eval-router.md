# PR 1: phase1-eval-router → main

**Title:** Phase 1: Router stabilization and faithfulness critic v2

## Summary

3-tier router, faithfulness critic v2, deterministic no-evidence guard, and Scout eval harness. This is the router foundation PR.

## Commits (7)

| Commit | Description |
|--------|-------------|
| `e5aa8b9` | Add Scout eval harness |
| `c9655ab` | Add 3-tier router + acceptableAny for trap cases |
| `09952e2` | Fix search_kb model synthesis, acceptableAny matching for trap cases |
| `fa81c7c` | Complete phase 1 router stabilization |
| `9fcdb27` | Wire Faithfulness Critic v2 into router responses |
| `156bd30` | Faithfulness Critic v2 with relevance anchors + retry-once logic |
| `09eb45c` | Add deterministic no-evidence guard for trap queries |

## Key files

- `apps/api/src/modules/router/router.service.ts` — 3-tier router with `routeScoutQuery()` + `answerWithRouter()`
- `apps/api/src/modules/router/router.router.ts` — Fastify `POST /router/answer` endpoint
- `apps/api/src/modules/router/router.schema.ts` — Zod input validation
- `apps/api/src/modules/router/faithfulness-critic.ts` — Evidence-anchored verification (v2)
- `harness/eval/` — 10-case eval suite with reward, trajectory, analysis

## Router tiers

| Tier | Route | Examples |
|------|-------|---------|
| 1 | `direct_model` | Pure coding questions (reverse linked list, algorithm) |
| 1 | `search_kb` | Document/KB lookup, no-evidence traps |
| 2 | `github_repo` | GitHub repo URLs |
| 2 | `web_research` | News, API docs, comparisons, current topics |
| 3 | `sandbox` | Computation, data transformation, sorting |

## Eval result

```text
Passed: 10/10
Mean reward: 6.0
Routing accuracy: 100%
Mean correctness: 1.0
Mean completeness: 1.0
```

## PR 2 (stacked)

Base: `phase1-eval-router` → Head: `phase1-research-perf-reranker`

Adds research performance, source relevance gate, harness v2, cleanup, and coding fast paths.

---

_To create: `gh pr create --base main --head phase1-eval-router --title "Phase 1: Router stabilization and faithfulness critic v2" --body "$(cat PR-1-phase1-eval-router.md)"`_
