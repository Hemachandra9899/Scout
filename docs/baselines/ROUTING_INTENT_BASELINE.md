# Routing Intent Baseline

Date: 2026-06-28
Branch: phase3-repo-graphify
Commit: TBD (before commit)

## Commands

```bash
npm run eval:routing-intent
npm run eval:ci
npm run eval:phase2
npm run eval:phase3
```

## Results

| Metric           | Value     |
| ---------------- | --------- |
| Routing cases    | 16        |
| Passed           | 0         |
| Failed           | 16        |
| Routing accuracy | 0%        |
| Mean latency     | N/A       |
| p95 latency      | N/A       |

All 16 cases failed with `fetch failed` — the API server was not running. These are integration tests requiring `localhost:8000` to be live with the full Scout stack.

## Failure Analysis

All cases: `request_error:fetch failed` — the harness calls the API server which was not running.

| Case | Expected | Actual | Reason |
| ---- | -------- | ------ | ------ |
| All  | various  | null   | API server not running |

## Cases added

### `harness/eval/routing-intent-cases/adversarial-routing.json` (15 cases)

| id | intent | expectedTool | description |
|---|---|---|---|
| routing-code-compare-arrays-001 | code | direct_model | Compare arrays — should not route to web research |
| routing-uploaded-api-key-001 | kb | search_kb | "api key in uploaded file" — should not route to web research |
| routing-github-repo-001 | github_repo | github_repo | GitHub URL analysis |
| routing-memo-repo-001 | memo_repo | github_repo | Memo this repo |
| routing-graphify-repo-001 | graphify_repo | github_repo | Graphify this repo |
| routing-update-repo-graph-001 | update_repo_graph | github_repo | Update repo graph |
| routing-query-graph-001 | query_graph | query_graph | Worker-RLM runtime connection via graph |
| routing-graph-report-001 | graph_report | query_graph | Generate GRAPH_REPORT.md |
| routing-latest-news-001 | web_research | web_research | WhatsApp news |
| routing-api-docs-001 | web_research | web_research | Google Ads vs Meta API |
| routing-sandbox-compute-001 | sandbox | sandbox | Sort/dedupe/mean computation |
| routing-code-linked-list-001 | code | direct_model | Reverse linked list code |
| routing-private-doc-no-evidence-001 | insufficient_evidence | search_kb | Unavailable private doc |
| routing-kb-readme-001 | kb | search_kb | Scout README from KB |
| routing-typo-graph-report-001 | graph_report | query_graph | Typo'd graph report query |

### `harness/eval/routing-intent-cases/provider-fallback.json` (1 case)

| id | intent | expectedTool | description |
|---|---|---|---|
| provider-firecrawl-disabled-001 | provider_fallback | web_research | Firecrawl disabled research |

## Known bugs in current router

From the platform plan (Section 1):
1. `router.service.ts:299` — `isRepoGraphReportQuery` tests `q.includes("generate.*graph.*report")` (literal regex string). **Never matches.**
2. `router.service.ts:455–483` — bare `"api"` and `"compare"` substrings force `web_research`, mis-routing code and KB queries.
3. `memory-manager.ts` — `addMany` dedupes within a batch only; durable facts re-written every run.
4. `search-provider-config.ts` — Firecrawl was enabled in every route (now fixed to `false` by default).

## Notes

This is the baseline before adding the unified intent classifier.
Do not implement the LLM classifier until this baseline exists.

Baseline runs require a running API server. To run:

```bash
# Terminal 1: start the API
npm run dev:api

# Terminal 2: run the eval
FIRECRAWL_ENABLED=false npm run eval:routing-intent
```
