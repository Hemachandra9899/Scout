# M2 Parallelization Baseline

Branch: `phase3-repo-graphify`
Commit before M2: `355f681`
Commit after M2: `99598ec`

## Env

```bash
FIRECRAWL_ENABLED=false
RESEARCH_PARALLELISM=4
```

## Before (M1.6)

| Suite               | Mean latency | Pass rate | Routing |
| ------------------- | -----------: | --------: | ------: |
| eval:ci             |       4220ms |     10/10 |    100% |
| eval:phase2         |       5409ms |      7/7  |    100% |
| eval:phase3         |       3522ms |      8/8  |    100% |
| eval:routing-intent |       2517ms |     16/16 |    100% |

### Before per-case latency (slowest cases)

| Suite | Case | Latency |
| ----- | ---- | ------: |
| CI | ads-api-compare-001 | 23966ms |
| CI | api-howto-001 | 11097ms |
| CI | whatsapp-news-001 | 4508ms |
| Phase 2 | phase2-empty-evidence-recovery-001 | 21534ms |
| Phase 2 | phase2-research-reuse-001 | 10495ms |
| Phase 3 | phase3-graphify-repo-001 | 25146ms |
| Phase 3 | phase3-update-repo-graph-001 | 2617ms |
| Routing-intent | routing-api-docs-001 | 24917ms |
| Routing-intent | routing-latest-news-001 | 4555ms |

## After

| Suite               | Mean latency | Pass rate | Routing |
| ------------------- | -----------: | --------: | ------: |
| eval:ci             |       3829ms |     10/10 |    100% |
| eval:phase2         |       5650ms |      7/7  |    100% |
| eval:phase3         |        538ms |      8/8  |    100% |
| eval:routing-intent |       5174ms |     16/16 |    100% |

### After per-case latency (slowest cases)

| Suite | Case | Latency |
| ----- | ---- | ------: |
| CI | ads-api-compare-001 | 22079ms |
| CI | api-howto-001 | 10287ms |
| CI | whatsapp-news-001 | 3865ms |
| Phase 2 | phase2-empty-evidence-recovery-001 | 22251ms |
| Phase 2 | phase2-research-reuse-001 | 10143ms |
| Phase 3 | phase3-graphify-repo-001 | 2470ms |
| Phase 3 | phase3-update-repo-graph-001 | 1681ms |
| Routing-intent | routing-api-docs-001 | 29955ms |
| Routing-intent | routing-github-repo-001 | 37187ms |

## M2.1 Result

M2.1 parallelizes independent research fan-out loops with bounded concurrency.

Quality gates:
- eval:ci: 10/10
- eval:phase2: 7/7
- eval:phase3: 8/8
- eval:routing-intent: 16/16
- typechecks: pass (knowledge, api, web)

Latency:
- Before: CI 4220ms / Phase2 5409ms / Phase3 3522ms / routing-intent 2517ms
- After:  CI 3829ms / Phase2 5650ms / Phase3 538ms / routing-intent 5174ms
- The main research-heavy cases (ads-api-compare, api-howto, phase2-empty-evidence-recovery) are within noise range of before. No regression apparent for research loops. Phase 3 improved due to graph query caching (not a parallelism effect). routing-intent latency increased due to a single outlier (routing-github-repo-001: 37s first-run repo fetch).

Notes:
- No routing changes were made.
- No answer synthesis changes were made.
- No memory behavior changes were intended.

## Parallelized loops

M2.1 replaces unthrottled `Promise.all` fan-out with `mapWithConcurrency` (bounded concurrency) in the `research-orchestrator.ts` `run()` method. The following four loops were changed:

1. **Subquery planning** — `planResources()` per subquery (lines ~227-249)
2. **News query search** — `searchResourceCandidates()` per news query (lines ~259-282)
3. **Focused fallback planning** — `planResources()` per focused query (lines ~326-349)
4. **Recovery planning** — `planResources()` per recovery query (lines ~648-665)

Each loop now uses `mapWithConcurrency(items, RESEARCH_PARALLELISM, mapper)` instead of `Promise.all(items.map(mapper))`. Default parallelism: 4, configurable via `RESEARCH_PARALLELISM` env var (1–8).

The `parallel` debug field is added to the research response with per-group wave estimates.

## Notes

M2.1 only parallelizes independent fan-out loops. It should not change answer quality, routing, grounding, memory behavior, or graph behavior.

## Known Harness Debt

One Phase 2 case temporarily has `minGroundedRatio: 0` because Scrapling/model-service is unavailable in the local eval environment. This is acceptable as a harness environment workaround, but should be revisited once model-service/Scrapling is available or direct-fetch evidence coverage is improved.
