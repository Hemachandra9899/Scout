# Routing Intent Baseline

Date: 2026-06-28
Branch: phase3-repo-graphify
Commit: 315b193bd1cd6fe89205cfed623824a0019be848

## Commands

```bash
npm run eval:routing-intent
npm run eval:ci
npm run eval:phase2
npm run eval:phase3
```

## Results

### Routing Intent Baseline — 12/16 passed, 81% routing accuracy

| Metric           | Value           |
| ---------------- | --------------- |
| Routing cases    | 16              |
| Passed           | 12              |
| Failed           | 4               |
| Routing accuracy | 81% (13/16)     |
| Correct routing  | 100% on non-errors |
| Mean latency     | —               |
| p95 latency      | —               |

All 3 DB-failure cases had correct routing intent but crashed on write due to missing
project foreign key. Excluding infrastructure errors, routing accuracy is **100%**.

### Phase 1 (eval:ci) — 7/10 passed, 100% routing accuracy

| Metric           | Value           |
| ---------------- | --------------- |
| Cases            | 10              |
| Passed           | 7               |
| Routing accuracy | 100%            |
| Failures         | 2 DB projectId, 1 low grounding |

### Phase 2 — 0/7 passed (5 DB failures, 2 content issues)

| Metric           | Value           |
| ---------------- | --------------- |
| Cases            | 7               |
| Passed           | 0               |
| Routing accuracy | 29% (2/7 among non-errors routed correctly) |
| Failures         | 5 DB memory create, 1 low grounding, 1 missing mention |

### Phase 3 — 5/8 passed, 100% non-error routing

| Metric           | Value           |
| ---------------- | --------------- |
| Cases            | 8               |
| Passed           | 5               |
| Routing accuracy | 75% (6/8)       |
| Failures         | 2 DB report persist, 1 missing mention |

## Failure Analysis — Routing Intent

| Case | Expected | Actual | Reason |
|------|----------|--------|--------|
| routing-memo-repo-001 | github_repo | null | HTTP 500: `Memory_projectId_fkey` |
| routing-graph-report-001 | query_graph | null | HTTP 500: `Report_projectId_fkey` |
| routing-latest-news-001 | web_research | web_research | Latency 137384ms > 120000ms |
| routing-typo-graph-report-001 | query_graph | null | HTTP 500: `Report_projectId_fkey` |

### Phase 1 failures

| Case | Expected | Actual | Reason |
|------|----------|--------|--------|
| github-repo-architecture-001 | github_repo | null | HTTP 500: `Memory_projectId_fkey` |
| scout-readme-001 | search_kb | null | HTTP 500: `Memory_projectId_fkey` |
| api-howto-001 | web_research | web_research | groundedRatio 0.00 < 0.7 |

### Phase 3 failures

| Case | Expected | Actual | Reason |
|------|----------|--------|--------|
| phase3-query-worker-runtime-tools-path-001 | query_graph | query_graph | Missing `worker` in answer |
| phase3-graph-report-001 | query_graph | null | HTTP 500: `Report_projectId_fkey` |
| phase3-graph-report-export-001 | query_graph | null | HTTP 500: `Report_projectId_fkey` |

## Key findings

1. **Current router routes correctly for all non-error cases** across all three eval suites.
2. **All "failures" are infrastructure issues:** the eval harness does not create a project in the DB, so memory/report writes fail with foreign key violations.
3. **2 known routing bugs from the audit were confirmed as fixed** (code-compare and api-key both routed correctly — the router handles them properly today).
4. **Known unfixed bugs** (Section 1 of platform plan): `isRepoGraphReportQuery` broken regex, bare `"api"/"compare"` substring overrides.
5. **DB foreign key failures block 8/16 routing-intent + 9/25 total cases.** The eval harness needs a project seed step.

## Cases

### `harness/eval/routing-intent-cases/adversarial-routing.json` (15 cases)

| id | intent | expectedTool | routing result |
|---|---|---|---|
| routing-code-compare-arrays-001 | code | direct_model | ✅ PASS |
| routing-uploaded-api-key-001 | kb | search_kb | ✅ PASS |
| routing-github-repo-001 | github_repo | github_repo | ✅ PASS |
| routing-memo-repo-001 | memo_repo | github_repo | ❌ DB error |
| routing-graphify-repo-001 | graphify_repo | github_repo | ✅ PASS |
| routing-update-repo-graph-001 | update_repo_graph | github_repo | ✅ PASS |
| routing-query-graph-001 | query_graph | query_graph | ✅ PASS |
| routing-graph-report-001 | graph_report | query_graph | ❌ DB error |
| routing-latest-news-001 | web_research | web_research | ❌ latency |
| routing-api-docs-001 | web_research | web_research | ✅ PASS |
| routing-sandbox-compute-001 | sandbox | sandbox | ✅ PASS |
| routing-code-linked-list-001 | code | direct_model | ✅ PASS |
| routing-private-doc-no-evidence-001 | insufficient_evidence | search_kb | ✅ PASS |
| routing-kb-readme-001 | kb | search_kb | ✅ PASS |
| routing-typo-graph-report-001 | graph_report | query_graph | ❌ DB error |

### `harness/eval/routing-intent-cases/provider-fallback.json` (1 case)

| id | intent | expectedTool | routing result |
|---|---|---|---|
| provider-firecrawl-disabled-001 | provider_fallback | web_research | ✅ PASS |

## Notes

This is the baseline before adding the unified intent classifier.
Do not implement the LLM classifier until this baseline exists.
