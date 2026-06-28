# M2 Parallelization Baseline

Branch: `phase3-repo-graphify`
Commit before M2: `355f681`
Commit after M2: TBD

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
| eval:ci             |         TBD  |       TBD |    TBD  |
| eval:phase2         |         TBD  |       TBD |    TBD  |
| eval:phase3         |         TBD  |       TBD |    TBD  |
| eval:routing-intent |         TBD  |       TBD |    TBD  |

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
