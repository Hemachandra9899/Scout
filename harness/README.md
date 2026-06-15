# Scout Research Benchmark Suite

This suite runs fixed real-world research queries against the local Scout API.

## Prerequisites

Start the stack:

```bash
docker compose build
docker compose up
```

Set provider keys in `.env` before starting Docker:

```bash
FIRECRAWL_API_KEY=...
TAVILY_API_KEY=...
GITHUB_TOKEN=...
```

## Run

```bash
API_BASE_URL=http://localhost:8000 \
BENCHMARK_PROJECT_ID=test-project \
npm run benchmark:research
```

Quick run:

```bash
BENCHMARK_MAX_QUERIES=3 npm run benchmark:research
```

Allow failures without non-zero exit:

```bash
BENCHMARK_ALLOW_FAILURES=1 npm run benchmark:research
```

## Outputs

Each run writes to:

```text
harness-runs/<timestamp>/
```

Files:

```text
summary.json
summary.csv
summary.md
01-query-id.json
02-query-id.json
...
```

## Pass criteria

Each query passes when:

```text
contractVersion = research-response-v1
answer.groundingAudit / ui.groundingStatus = pass
groundingIssueCount = 0
citations.length >= query.minCitations
crawlTrace.acceptedPages >= query.minAcceptedPages
evidencePack.coverage.filteredClaimCount >= query.minFilteredClaims
```

Tune thresholds in `benchmarks/research-queries.json`.
