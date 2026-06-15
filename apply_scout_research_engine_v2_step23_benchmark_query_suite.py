#!/usr/bin/env python3
# Apply Scout Research Engine v2 Step 23:
# Benchmark Query Suite.
#
# Run from Scout repo root AFTER Step 22 and Docker/API smoke tests.
#
# This patch:
# - Adds a fixed benchmark query suite.
# - Adds a dependency-free Node benchmark runner.
# - Calls POST /tools/web-research with useOrchestrator=true.
# - Saves every raw response as JSON.
# - Writes summary.json, summary.md, and summary.csv.
# - Adds pass/fail thresholds for grounding, citations, evidence, and crawl success.
# - Adds root script: npm run benchmark:research
#
# Usage:
#   API_BASE_URL=http://localhost:8000 \
#   BENCHMARK_PROJECT_ID=test-project \
#   npm run benchmark:research

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path.cwd()


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content.strip() + "\n", encoding="utf-8")
    print(f"wrote {path}")


def read_json(path: str) -> dict:
    return json.loads((ROOT / path).read_text(encoding="utf-8"))


def write_json(path: str, data: dict) -> None:
    (ROOT / path).write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    print(f"updated {path}")


def assert_repo_root() -> None:
    required = [
        "package.json",
        "apps/api/src/modules/tools/tools.service.ts",
    ]
    missing = [p for p in required if not (ROOT / p).exists()]
    if missing:
        raise SystemExit(
            "Run from Scout repo root after Step 22. Missing:\n"
            + "\n".join(f"- {p}" for p in missing)
        )


QUERIES_JSON = r'''
[
  {
    "id": "google-ads-api-auth-rate-limits",
    "category": "ads-api",
    "query": "Find TypeScript SDK examples for building a Google Ads API integration. Include authentication, permissions, rate limits, and implementation risks.",
    "minAcceptedPages": 1,
    "minFilteredClaims": 5,
    "minCitations": 1
  },
  {
    "id": "meta-marketing-api-permissions",
    "category": "ads-api",
    "query": "Explain Meta Marketing API permissions for campaign automation, including app review, required scopes, rate-limit risks, and the safest MVP implementation plan.",
    "minAcceptedPages": 1,
    "minFilteredClaims": 5,
    "minCitations": 1
  },
  {
    "id": "tiktok-ads-api-campaign-automation",
    "category": "ads-api",
    "query": "Research TikTok Ads API campaign automation capabilities. Cover authentication, campaign/ad group/ad creation, reporting access, permissions, and implementation risks.",
    "minAcceptedPages": 1,
    "minFilteredClaims": 5,
    "minCitations": 1
  },
  {
    "id": "stripe-billing-subscriptions",
    "category": "payments-api",
    "query": "Compare Stripe Billing API subscription lifecycle implementation details: customer creation, prices, subscriptions, invoices, webhooks, and common failure modes.",
    "minAcceptedPages": 1,
    "minFilteredClaims": 5,
    "minCitations": 1
  },
  {
    "id": "shopify-admin-product-api",
    "category": "commerce-api",
    "query": "Research Shopify Admin API product creation and inventory update workflow. Include authentication, required permissions, rate limits, and GraphQL versus REST tradeoffs.",
    "minAcceptedPages": 1,
    "minFilteredClaims": 5,
    "minCitations": 1
  },
  {
    "id": "github-rest-fine-grained-tokens",
    "category": "developer-api",
    "query": "Explain GitHub REST API fine-grained personal access token permissions for repository search, contents access, issues, and pull requests. Include implementation risks.",
    "minAcceptedPages": 1,
    "minFilteredClaims": 5,
    "minCitations": 1
  },
  {
    "id": "slack-oauth-bot-scopes",
    "category": "developer-api",
    "query": "Research Slack API OAuth scopes for a bot app that reads messages, posts replies, and searches channels. Include token types, permissions, and app review risks.",
    "minAcceptedPages": 1,
    "minFilteredClaims": 5,
    "minCitations": 1
  },
  {
    "id": "notion-database-query-limits",
    "category": "developer-api",
    "query": "Research Notion API database querying limits and best practices. Include authentication, pagination, filtering, rate limits, and integration permissions.",
    "minAcceptedPages": 1,
    "minFilteredClaims": 5,
    "minCitations": 1
  },
  {
    "id": "hubspot-crm-associations",
    "category": "crm-api",
    "query": "Explain HubSpot CRM API contact, company, and deal association model. Include authentication, object APIs, association APIs, rate limits, and sync risks.",
    "minAcceptedPages": 1,
    "minFilteredClaims": 5,
    "minCitations": 1
  },
  {
    "id": "salesforce-rest-oauth-crud",
    "category": "crm-api",
    "query": "Research Salesforce REST API OAuth and object CRUD implementation. Include connected app setup, token flow, object metadata, limits, and integration risks.",
    "minAcceptedPages": 1,
    "minFilteredClaims": 5,
    "minCitations": 1
  },
  {
    "id": "openai-api-structured-outputs",
    "category": "ai-api",
    "query": "Research OpenAI API structured outputs for production extraction workflows. Include schema constraints, model support, API usage pattern, and failure handling.",
    "minAcceptedPages": 1,
    "minFilteredClaims": 5,
    "minCitations": 1
  },
  {
    "id": "anthropic-api-tool-use",
    "category": "ai-api",
    "query": "Research Anthropic API tool use for building an agent. Include message format, tool schemas, tool result handling, streaming, and implementation risks.",
    "minAcceptedPages": 1,
    "minFilteredClaims": 5,
    "minCitations": 1
  }
]
'''

RUNNER_MJS = r'''
#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const API_BASE_URL = (process.env.API_BASE_URL || "http://localhost:8000").replace(/\/$/, "");
const PROJECT_ID = process.env.BENCHMARK_PROJECT_ID || "benchmark-project";
const OUTPUT_DIR =
  process.env.BENCHMARK_OUTPUT_DIR ||
  path.join("harness-runs", new Date().toISOString().replace(/[:.]/g, "-"));
const MAX_QUERIES = Number(process.env.BENCHMARK_MAX_QUERIES || 0);
const REQUEST_TIMEOUT_MS = Number(process.env.BENCHMARK_TIMEOUT_MS || 180_000);

const DEFAULT_PAYLOAD = {
  maxResults: Number(process.env.BENCHMARK_MAX_RESULTS || 6),
  maxPagesPerSource: Number(process.env.BENCHMARK_MAX_PAGES_PER_SOURCE || 3),
  maxTotalPages: Number(process.env.BENCHMARK_MAX_TOTAL_PAGES || 14),
  maxDepth: Number(process.env.BENCHMARK_MAX_DEPTH || 1),
  useOrchestrator: true,
};

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeNumber(value, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

async function readJsonFile(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function postJson(url, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { rawText: text };
    }

    if (!response.ok) {
      const message = data?.message || data?.error || text || response.statusText;
      throw new Error(`HTTP ${response.status}: ${message}`);
    }

    return data;
  } finally {
    clearTimeout(timeout);
  }
}

function extractMetrics(response) {
  const ui = response?.ui ?? {};
  const debug = response?.debug ?? {};
  const coverage = ui.evidenceCoverage ?? response?.evidencePack?.coverage ?? {};
  const crawlTrace = ui.crawlTrace ?? response?.crawlTrace ?? {};
  const answer = response?.answer ?? {};
  const grounding = answer.groundingAudit ?? {
    status: ui.groundingStatus,
    issueCount: safeArray(ui.groundingIssues).length,
  };

  return {
    status: response?.status ?? "unknown",
    contractVersion: response?.contractVersion,
    answerMode: ui.answerMode ?? answer.mode,
    groundingStatus: ui.groundingStatus ?? grounding.status,
    groundingIssueCount: safeNumber(grounding.issueCount ?? safeArray(grounding.issues).length),
    citationsLength: safeArray(ui.citations ?? answer.citations).length,
    warningsLength: safeArray(ui.warnings).length,
    acceptedPages: safeNumber(crawlTrace.acceptedPages),
    skippedPages: safeNumber(crawlTrace.skippedPages),
    retryCount: safeNumber(crawlTrace.retryCount),
    rejectedByQuality: safeNumber(crawlTrace.rejectedByQuality),
    rejectedByDuplicateUrl: safeNumber(crawlTrace.rejectedByDuplicateUrl),
    rejectedByDuplicateContent: safeNumber(crawlTrace.rejectedByDuplicateContent),
    rawClaimCount: safeNumber(coverage.rawClaimCount ?? coverage.claimCount),
    filteredClaimCount: safeNumber(coverage.filteredClaimCount ?? coverage.claimCount),
    qualityRejectedClaimCount: safeNumber(coverage.qualityRejectedClaimCount),
    duplicateRejectedClaimCount: safeNumber(coverage.duplicateRejectedClaimCount),
    supportedClaimCount: safeNumber(coverage.supportedClaimCount),
    weakClaimCount: safeNumber(coverage.weakClaimCount),
    unsupportedClaimCount: safeNumber(coverage.unsupportedClaimCount),
    missingCoverageCount: safeArray(coverage.missing).length,
    resourcesPlanned: safeNumber(debug?.search?.resourcesPlanned ?? safeArray(response?.resourcesPlanned).length),
    selectedProviders: safeArray(debug?.search?.selectedProviders).join("|"),
    routeKinds: safeArray(debug?.search?.routeKinds).join("|"),
  };
}

function evaluate(query, metrics, error) {
  const failures = [];

  if (error) {
    failures.push(`request_error:${error.message}`);
    return { passed: false, failures };
  }

  if (metrics.contractVersion !== "research-response-v1") failures.push("missing_contract_version");
  if (metrics.groundingStatus !== "pass") failures.push(`grounding_not_pass:${metrics.groundingStatus ?? "missing"}`);
  if (metrics.groundingIssueCount > 0) failures.push(`grounding_issues:${metrics.groundingIssueCount}`);
  if (metrics.citationsLength < (query.minCitations ?? 1)) failures.push(`low_citations:${metrics.citationsLength}`);
  if (metrics.acceptedPages < (query.minAcceptedPages ?? 1)) failures.push(`low_accepted_pages:${metrics.acceptedPages}`);
  if (metrics.filteredClaimCount < (query.minFilteredClaims ?? 3)) failures.push(`low_filtered_claims:${metrics.filteredClaimCount}`);

  return { passed: failures.length === 0, failures };
}

function toCsvCell(value) {
  if (value === undefined || value === null) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function rowsToCsv(rows) {
  const headers = [
    "id",
    "category",
    "passed",
    "failures",
    "status",
    "answerMode",
    "groundingStatus",
    "groundingIssueCount",
    "citationsLength",
    "acceptedPages",
    "skippedPages",
    "retryCount",
    "rejectedByQuality",
    "rejectedByDuplicateUrl",
    "rejectedByDuplicateContent",
    "rawClaimCount",
    "filteredClaimCount",
    "qualityRejectedClaimCount",
    "duplicateRejectedClaimCount",
    "supportedClaimCount",
    "weakClaimCount",
    "unsupportedClaimCount",
    "warningsLength",
    "resourcesPlanned",
    "selectedProviders",
    "routeKinds",
    "durationMs",
  ];

  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => toCsvCell(row[header])).join(",")),
  ].join("\n");
}

function rowsToMarkdown(rows, aggregate) {
  const lines = [];
  lines.push("# Scout Research Benchmark Summary");
  lines.push("");
  lines.push(`- Started: ${aggregate.startedAt}`);
  lines.push(`- Finished: ${aggregate.finishedAt}`);
  lines.push(`- API: ${aggregate.apiBaseUrl}`);
  lines.push(`- Project: ${aggregate.projectId}`);
  lines.push(`- Passed: ${aggregate.passed}/${aggregate.total}`);
  lines.push(`- Failed: ${aggregate.failed}/${aggregate.total}`);
  lines.push("");
  lines.push("| Query | Pass | Grounding | Claims | Citations | Pages | Retries | Failures |");
  lines.push("| --- | --- | --- | ---: | ---: | ---: | ---: | --- |");

  for (const row of rows) {
    lines.push(
      `| ${row.id} | ${row.passed ? "✅" : "❌"} | ${row.groundingStatus || "—"} | ${row.filteredClaimCount ?? 0} | ${row.citationsLength ?? 0} | ${row.acceptedPages ?? 0} | ${row.retryCount ?? 0} | ${row.failures || ""} |`
    );
  }

  lines.push("");
  lines.push("## Failed cases");
  lines.push("");

  const failedRows = rows.filter((row) => !row.passed);
  if (failedRows.length === 0) {
    lines.push("No failed cases.");
  } else {
    for (const row of failedRows) lines.push(`- **${row.id}**: ${row.failures}`);
  }

  return lines.join("\n");
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const queryFile = process.env.BENCHMARK_QUERY_FILE || "benchmarks/research-queries.json";
  const allQueries = await readJsonFile(queryFile);
  const queries = MAX_QUERIES > 0 ? allQueries.slice(0, MAX_QUERIES) : allQueries;

  const startedAt = new Date().toISOString();
  const rows = [];

  console.log(`Running ${queries.length} benchmark queries against ${API_BASE_URL}`);
  console.log(`Output directory: ${OUTPUT_DIR}`);

  for (const [index, query] of queries.entries()) {
    const started = Date.now();
    const id = query.id;
    const responsePath = path.join(OUTPUT_DIR, `${String(index + 1).padStart(2, "0")}-${id}.json`);

    console.log(`\n[${index + 1}/${queries.length}] ${id}`);
    console.log(query.query);

    let response = null;
    let error = null;
    let metrics = {};

    try {
      response = await postJson(`${API_BASE_URL}/tools/web-research`, {
        projectId: PROJECT_ID,
        query: query.query,
        ...DEFAULT_PAYLOAD,
        ...(query.payload ?? {}),
      });
      metrics = extractMetrics(response);
      await fs.writeFile(responsePath, JSON.stringify(response, null, 2));
    } catch (err) {
      error = err instanceof Error ? err : new Error(String(err));
      await fs.writeFile(responsePath, JSON.stringify({ error: error.message, query }, null, 2));
    }

    const evaluation = evaluate(query, metrics, error);
    const durationMs = Date.now() - started;

    const row = {
      id,
      category: query.category ?? "",
      passed: evaluation.passed,
      failures: evaluation.failures.join("; "),
      durationMs,
      ...metrics,
    };

    rows.push(row);

    console.log(
      `${evaluation.passed ? "PASS" : "FAIL"} | grounding=${row.groundingStatus} | claims=${row.filteredClaimCount ?? 0} | citations=${row.citationsLength ?? 0} | pages=${row.acceptedPages ?? 0} | ${evaluation.failures.join("; ")}`
    );
  }

  const finishedAt = new Date().toISOString();
  const aggregate = {
    startedAt,
    finishedAt,
    apiBaseUrl: API_BASE_URL,
    projectId: PROJECT_ID,
    total: rows.length,
    passed: rows.filter((row) => row.passed).length,
    failed: rows.filter((row) => !row.passed).length,
    passRate: rows.length ? rows.filter((row) => row.passed).length / rows.length : 0,
  };

  const summary = { aggregate, rows };

  await fs.writeFile(path.join(OUTPUT_DIR, "summary.json"), JSON.stringify(summary, null, 2));
  await fs.writeFile(path.join(OUTPUT_DIR, "summary.csv"), rowsToCsv(rows));
  await fs.writeFile(path.join(OUTPUT_DIR, "summary.md"), rowsToMarkdown(rows, aggregate));

  console.log("\nBenchmark complete.");
  console.log(`Passed: ${aggregate.passed}/${aggregate.total}`);
  console.log(`Summary: ${path.join(OUTPUT_DIR, "summary.md")}`);

  if (aggregate.failed > 0 && process.env.BENCHMARK_ALLOW_FAILURES !== "1") process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
'''

README_MD = r'''
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
'''

ROOT_README_APPEND = r'''
---

## Benchmark query suite

Scout includes a fixed research benchmark suite.

Run after Docker is up:

```bash
API_BASE_URL=http://localhost:8000 \
BENCHMARK_PROJECT_ID=test-project \
npm run benchmark:research
```

Quick smoke:

```bash
BENCHMARK_MAX_QUERIES=3 npm run benchmark:research
```

Outputs are written to:

```text
harness-runs/<timestamp>/
```

The runner validates:

```text
contractVersion
grounding status
citation count
accepted crawl pages
filtered evidence count
```
'''

TODO_APPEND = r'''
## Done in v2 Slice 21

- [x] Added benchmark query fixtures.
- [x] Added dependency-free Node benchmark runner.
- [x] Added raw response JSON output per query.
- [x] Added summary.json, summary.csv, and summary.md outputs.
- [x] Added pass/fail thresholds for grounding, citations, crawl pages, and evidence claims.
- [x] Added root `benchmark:research` script.

## Now

### Benchmark validation

- [ ] Start Docker stack.
- [ ] Run `BENCHMARK_MAX_QUERIES=3 npm run benchmark:research`.
- [ ] Run full `npm run benchmark:research`.
- [ ] Inspect failed cases in `harness-runs/<timestamp>/summary.md`.
- [ ] Use benchmark failures to tune crawler/evidence thresholds.
'''

LESSONS_APPEND = r'''
## Research Engine v2 Slice 21

- Real query suites are needed before adding LLM polish.
- A benchmark should save raw responses so failures can be debugged later.
- Pass/fail criteria should focus on grounding, citations, crawl success, and filtered evidence.
- Benchmarks should be dependency-free and runnable against the local Docker API.
'''


def update_root_package() -> None:
    pkg = read_json("package.json")
    scripts = pkg.setdefault("scripts", {})
    scripts["benchmark:research"] = "node benchmarks/run-research-benchmark.mjs"
    write_json("package.json", pkg)


def update_gitignore() -> None:
    path = ROOT / ".gitignore"
    text = path.read_text(encoding="utf-8") if path.exists() else ""
    additions = []
    if "harness-runs/" not in text:
        additions.append("harness-runs/")
    if "!harness-runs/.gitkeep" not in text:
        additions.append("!harness-runs/.gitkeep")
    if additions:
        text = text.rstrip() + "\n\n# Scout harness outputs\n" + "\n".join(additions) + "\n"
        path.write_text(text, encoding="utf-8")
        print("updated .gitignore")


def append_once(path: str, heading: str, content: str) -> None:
    target = ROOT / path
    if not target.exists():
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content.strip() + "\n", encoding="utf-8")
        print(f"wrote {path}")
        return
    text = target.read_text(encoding="utf-8")
    if heading in text:
        print(f"skipped {path}; already contains {heading}")
        return
    target.write_text(text.rstrip() + "\n\n" + content.strip() + "\n", encoding="utf-8")
    print(f"updated {path}")


def main() -> None:
    assert_repo_root()
    write("harness/research-queries.json", QUERIES_JSON)
    write("harness/run-research-benchmark.mjs", RUNNER_MJS)
    write("harness/README.md", README_MD)
    write("harness-runs/.gitkeep", "")
    update_root_package()
    update_gitignore()
    append_once("README.md", "Benchmark query suite", ROOT_README_APPEND)
    append_once("docs/TODO.md", "Done in v2 Slice 21", TODO_APPEND)
    append_once("docs/LESSONS.md", "Research Engine v2 Slice 21", LESSONS_APPEND)
    print("\nDone.")
    print("\nNext commands:")
    print("  docker compose build")
    print("  docker compose up")
    print("\nIn another terminal:")
    print("  BENCHMARK_MAX_QUERIES=3 npm run benchmark:research")
    print("  npm run benchmark:research")


if __name__ == "__main__":
    main()
