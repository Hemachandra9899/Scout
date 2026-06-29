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
