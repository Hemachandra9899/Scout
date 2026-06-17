#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { computeReward } from "./harness-reward.mjs";
import { buildTrajectory } from "./harness-trajectory.mjs";

const PROJECT_ID = process.env.EVAL_PROJECT_ID || process.env.BENCHMARK_PROJECT_ID || "benchmark-project";
const EVAL_TARGET = process.env.EVAL_TARGET || "rlm";
const API_BASE_URL = (process.env.API_BASE_URL || "http://localhost:8000").replace(/\/$/, "");
const RLM_RUNTIME_URL = (process.env.RLM_RUNTIME_URL || "http://localhost:8787").replace(/\/$/, "");
const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-");
const EVAL_USER_ID =
  process.env.EVAL_USER_ID ||
  `harness-${RUN_ID}`;
const OUTPUT_DIR =
  process.env.EVAL_OUTPUT_DIR ||
  path.join("harness-runs", RUN_ID);
const CASES_DIR = process.env.EVAL_CASES_DIR || "harness/eval/cases";
const MAX_CASES = Number(process.env.EVAL_MAX_CASES || 0);
const REQUEST_TIMEOUT_MS = Number(process.env.EVAL_TIMEOUT_MS || 180_000);
const FAIL_UNDER = Number(process.env.EVAL_FAIL_UNDER || 0);
const ENABLE_JUDGE = process.env.EVAL_JUDGE === "1";
const MODEL_SERVICE_URL = (process.env.MODEL_SERVICE_URL || "http://localhost:8100").replace(/\/$/, "");

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeNumber(value, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeText(value) {
  return String(value ?? "").toLowerCase();
}

function toCsvCell(value) {
  if (value === undefined || value === null) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function rowsToCsv(rows) {
  const headers = [
    "id",
    "intent",
    "passed",
    "failures",
    "expectedTier",
    "actualTier",
    "expectedTool",
    "actualTool",
    "routingPassed",
    "groundedRatio",
    "supportedClaimCount",
    "claimCount",
    "correctness",
    "completeness",
    "mustMentionPassed",
    "mustNotClaimPassed",
    "latencyPassed",
    "durationMs",
    "reward",
  ];

  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => toCsvCell(row[header])).join(",")),
  ].join("\n");
}

function rowsToMarkdown(rows, aggregate) {
  const lines = [];

  lines.push("# Scout Eval Summary");
  lines.push("");
  lines.push(`- Started: ${aggregate.startedAt}`);
  lines.push(`- Finished: ${aggregate.finishedAt}`);
  lines.push(`- Target: ${aggregate.target}`);
  lines.push(`- Project: ${aggregate.projectId}`);
  lines.push(`- Passed: ${aggregate.passed}/${aggregate.total}`);
  lines.push(`- Mean grounded ratio: ${aggregate.meanGroundedRatio.toFixed(3)}`);
  lines.push(`- Mean correctness: ${aggregate.meanCorrectness.toFixed(3)}`);
  lines.push(`- Mean completeness: ${aggregate.meanCompleteness.toFixed(3)}`);
  lines.push(`- Mean latency: ${Math.round(aggregate.meanLatencyMs)} ms`);
  lines.push(`- Mean reward: ${aggregate.meanReward.toFixed(2)}`);
  lines.push("");

  lines.push("| Case | Pass | Reward | Route | Tool | Grounded | Correct | Complete | Latency | Failures |");
  lines.push("| --- | --- | ---: | --- | --- | ---: | ---: | ---: | ---: | --- |");

  for (const row of rows) {
    lines.push(
      `| ${row.id} | ${row.passed ? "✅" : "❌"} | ${row.reward ?? ""} | ${row.actualTier ?? "?"}/${row.expectedTier ?? "?"} | ${row.actualTool ?? "?"}/${row.expectedTool ?? "?"} | ${row.groundedRatio.toFixed(2)} | ${row.correctness.toFixed(2)} | ${row.completeness.toFixed(2)} | ${row.durationMs} | ${row.failures} |`
    );
  }

  lines.push("");
  lines.push("## Failed cases");
  lines.push("");

  const failed = rows.filter((row) => !row.passed);
  if (failed.length === 0) {
    lines.push("No failed cases.");
  } else {
    for (const row of failed) {
      lines.push(`- **${row.id}**: ${row.failures}`);
    }
  }

  return lines.join("\n");
}

function parseCaseIdsFilter() {
  const raw = process.env.EVAL_CASE_IDS;
  if (!raw) return null;
  return new Set(
    raw
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
  );
}

function caseMatchesFilter(caseItem, filter) {
  if (!filter) return true;
  return (
    filter.has(caseItem.id) ||
    [...filter].some((id) => caseItem.id.includes(id))
  );
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function loadCases() {
  const entries = await fs.readdir(CASES_DIR, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(CASES_DIR, entry.name))
    .sort();

  const cases = [];

  for (const file of files) {
    const data = await readJson(file);
    if (Array.isArray(data)) {
      cases.push(...data.map((item) => ({ ...item, _file: file })));
    } else {
      cases.push({ ...data, _file: file });
    }
  }

  return MAX_CASES > 0 ? cases.slice(0, MAX_CASES) : cases;
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
      const message = data?.message || data?.error || data?.detail || text || response.statusText;
      throw new Error(`HTTP ${response.status}: ${typeof message === "string" ? message : JSON.stringify(message)}`);
    }

    return data;
  } finally {
    clearTimeout(timeout);
  }
}

async function callScout(caseItem) {
  if (EVAL_TARGET === "web_research") {
    return postJson(`${API_BASE_URL}/tools/web-research`, {
      projectId: PROJECT_ID,
      query: caseItem.query,
      maxResults: caseItem.maxResults ?? 6,
      maxPagesPerSource: caseItem.maxPagesPerSource ?? 3,
      maxTotalPages: caseItem.maxTotalPages ?? 14,
      maxDepth: caseItem.maxDepth ?? 1,
      useOrchestrator: true,
      ...(caseItem.payload ?? {}),
    });
  }

  if (EVAL_TARGET === "router") {
    const id = caseItem.id || "case";
    return postJson(`${API_BASE_URL}/router/answer`, {
      projectId: PROJECT_ID,
      userId: caseItem.userId ?? `${EVAL_USER_ID}-${id}`,
      query: caseItem.query,
      setupMessages: caseItem.setupMessages ?? [],
      ...(caseItem.payload ?? {}),
    });
  }

  return postJson(`${RLM_RUNTIME_URL}/execute`, {
    projectId: PROJECT_ID,
    query: caseItem.query,
    maxSteps: caseItem.maxSteps ?? 5,
    maxDepth: caseItem.maxDepth ?? 2,
    ...(caseItem.payload ?? {}),
  });
}

function extractAnswer(response) {
  if (typeof response?.ui?.answerMarkdown === "string") return response.ui.answerMarkdown;
  if (typeof response?.answer?.markdown === "string") return response.answer.markdown;
  if (typeof response?.answer?.answer === "string") return response.answer.answer;
  if (typeof response?.answer === "string") return response.answer;
  if (typeof response?.final === "string") return response.final;

  if (response?.final !== undefined && response?.final !== null) {
    try {
      return JSON.stringify(response.final, null, 2);
    } catch {
      return String(response.final);
    }
  }

  return "";
}

function extractCoverage(response) {
  return (
    response?.ui?.evidenceCoverage ??
    response?.evidencePack?.coverage ??
    response?.answer?.evidencePack?.coverage ??
    response?.debug?.evidence?.coverage ??
    response?.debug?.coverage ??
    {}
  );
}

function extractActualTool(response) {
  const explicit =
    response?.route?.tool ??
    response?.routing?.tool ??
    response?.debug?.route?.tool ??
    response?.debug?.routing?.tool ??
    response?.ui?.tool;

  if (explicit) return String(explicit);

  const steps = safeArray(response?.steps);
  const toolCalls = steps.flatMap((step) => safeArray(step?.toolCalls));

  if (toolCalls.includes("web_research")) return "web_research";
  if (toolCalls.includes("github_repo")) return "github_repo";
  if (toolCalls.includes("search_kb")) return "search_kb";
  if (toolCalls.includes("query_graph")) return "query_graph";
  if (toolCalls.length > 0) return String(toolCalls[0]);

  if (EVAL_TARGET === "web_research") return "web_research";

  return "direct_model";
}

function inferTierFromTool(tool, response) {
  const explicit =
    response?.route?.tier ??
    response?.routing?.tier ??
    response?.debug?.route?.tier ??
    response?.debug?.routing?.tier ??
    response?.ui?.tier;

  if (explicit !== undefined && explicit !== null) return Number(explicit);

  if (tool === "web_research") return 2;
  if (tool === "github_repo") return 2;
  if (tool === "search_kb") return 1;
  if (tool === "direct_model") return 1;
  if (tool === "sandbox") return 3;
  if (tool === "query_graph") return 3;

  return null;
}

function checkMustMention(answer, mustMention) {
  const a = normalizeText(answer);
  const hits = safeArray(mustMention).filter((item) => a.includes(normalizeText(item)));
  const missing = safeArray(mustMention).filter((item) => !a.includes(normalizeText(item)));

  return {
    passed: missing.length === 0,
    hits,
    missing,
    score: safeArray(mustMention).length
      ? hits.length / safeArray(mustMention).length
      : 1,
  };
}

function checkMustMentionAnyGroups(answer, groups) {
  const normalizedAnswer = normalizeText(answer);
  const safeGroups = Array.isArray(groups) ? groups : [];

  const results = safeGroups.map((group) => {
    const values = Array.isArray(group) ? group : [];
    const hits = values.filter((item) =>
      normalizedAnswer.includes(normalizeText(item))
    );

    return {
      group: values,
      hits,
      passed: hits.length > 0,
    };
  });

  return {
    enabled: safeGroups.length > 0,
    passed: results.every((item) => item.passed),
    results,
    missingGroups: results
      .filter((item) => !item.passed)
      .map((item) => item.group),
  };
}

function checkAcceptableAny(answer, acceptableAny) {
  const values = safeArray(acceptableAny);
  if (values.length === 0) return { enabled: false, passed: true, hits: [] };

  const a = normalizeText(answer);
  const hits = values.filter((item) => a.includes(normalizeText(item)));

  return {
    enabled: true,
    passed: hits.length > 0,
    hits,
  };
}

function checkMustNotClaim(answer, mustNotClaim) {
  const a = normalizeText(answer);
  const violations = safeArray(mustNotClaim).filter((item) => a.includes(normalizeText(item)));

  return {
    passed: violations.length === 0,
    violations,
  };
}

function computeGroundedRatio(coverage) {
  const supported = safeNumber(coverage.supportedClaimCount);
  const claimCount =
    safeNumber(coverage.claimCount) ||
    safeNumber(coverage.filteredClaimCount) ||
    supported +
      safeNumber(coverage.weakClaimCount) +
      safeNumber(coverage.unsupportedClaimCount);

  if (claimCount <= 0) return { supported, claimCount, groundedRatio: 0 };

  return {
    supported,
    claimCount,
    groundedRatio: supported / Math.max(claimCount, 1),
  };
}

async function judgeWithModel(caseItem, answer) {
  if (!ENABLE_JUDGE) {
    const mention = checkMustMention(answer, caseItem.mustMention);
    const acceptable = checkAcceptableAny(answer, caseItem.acceptableAny);
    const forbidden = checkMustNotClaim(answer, caseItem.mustNotClaim);

    const mentionScore = acceptable.enabled ? (acceptable.passed ? 1 : 0) : mention.score;

    return {
      correctness: forbidden.passed ? 1 : 0.3,
      completeness: mentionScore,
      missing: acceptable.enabled ? [] : mention.missing,
      errors: forbidden.violations,
      mode: "heuristic",
    };
  }

  const prompt = [
    "You are a strict grader for a research assistant.",
    "Return ONLY JSON, no markdown.",
    "",
    "Score 0.0-1.0.",
    "- correctness: factual accuracy against reference and forbidden claims.",
    "- completeness: coverage of MUST_MENTION points.",
    "",
    'JSON shape: {"correctness":0.0,"completeness":0.0,"missing":[],"errors":[]}',
    "",
    `QUESTION: ${caseItem.query}`,
    `REFERENCE: ${caseItem.referenceAnswer ?? ""}`,
    `MUST_MENTION: ${JSON.stringify(caseItem.mustMention ?? [])}`,
    `MUST_NOT_CLAIM: ${JSON.stringify(caseItem.mustNotClaim ?? [])}`,
    `ANSWER: ${answer}`,
  ].join("\n");

  try {
    const response = await postJson(`${MODEL_SERVICE_URL}/chat`, {
      mode: "reasoning",
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      top_p: 0.1,
      max_tokens: 512,
    });

    const text = response?.content ?? "";
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    const parsed = JSON.parse(text.slice(start, end + 1));

    return {
      correctness: Number(parsed.correctness ?? 0),
      completeness: Number(parsed.completeness ?? 0),
      missing: safeArray(parsed.missing),
      errors: safeArray(parsed.errors),
      mode: "llm_judge",
    };
  } catch (error) {
    const mention = checkMustMention(answer, caseItem.mustMention);
    const acceptable = checkAcceptableAny(answer, caseItem.acceptableAny);
    const forbidden = checkMustNotClaim(answer, caseItem.mustNotClaim);

    const mentionScore = acceptable.enabled ? (acceptable.passed ? 1 : 0) : mention.score;

    return {
      correctness: forbidden.passed ? 1 : 0.3,
      completeness: mentionScore,
      missing: acceptable.enabled ? [] : mention.missing,
      errors: [
        `judge_failed:${error instanceof Error ? error.message : String(error)}`,
        ...forbidden.violations,
      ],
      mode: "heuristic_fallback",
    };
  }
}

function extractPhase2SignalsFromResponse(response) {
  const debug = response?.debug ?? {};
  const memory = debug.memory ?? {};

  return {
    recallUsed: Boolean(
      debug.recallUsed ??
      memory.recallUsed ??
      response?.ui?.memory?.recallUsed,
    ),
    sourceReuseUsed: Boolean(
      debug.sourceReuseUsed ??
      memory.sourceReuseUsed ??
      response?.ui?.memory?.sourceReuseUsed,
    ),
    blockedSourceAvoided: Boolean(
      debug.blockedSourceAvoided ??
      memory.blockedSourceAvoided ??
      response?.ui?.memory?.blockedSourceAvoided,
    ),
    recoveryAttempted: Boolean(
      debug.recoveryAttempted ??
      response?.debug?.recoveryAttempted ??
      response?.rawToolResult?.debug?.recoveryAttempted ??
      response?.researchTrace?.some?.((stage) =>
        String(stage.name ?? "").toLowerCase().includes("recovery_retry") ||
        String(stage.name ?? "").toLowerCase().includes("retry"),
      ) ??
      response?.debug?.researchTrace?.some?.((stage) =>
        String(stage.name ?? "").toLowerCase().includes("recovery_retry") ||
        String(stage.name ?? "").toLowerCase().includes("retry"),
      ),
    ),
    graphContextUsed: Boolean(
      debug.graphContextUsed ??
      debug.graph?.used ??
      response?.ui?.graph?.used ??
      response?.rawToolResult?.debug?.graphContextUsed ??
      response?.rawToolResult?.debug?.graph?.used,
    ),
  };
}

function checkExpectedPhase2(caseItem, response) {
  const expected = caseItem.expectedPhase2 ?? {};
  const signals = extractPhase2SignalsFromResponse(response);

  const failures = Object.entries(expected)
    .filter(([, expectedValue]) => typeof expectedValue === "boolean")
    .filter(([key, expectedValue]) => signals[key] !== expectedValue)
    .map(([key, expectedValue]) => `${key} expected ${expectedValue}, got ${signals[key]}`);

  return {
    signals,
    passed: failures.length === 0,
    failures,
  };
}

function evaluateCase(caseItem, response, answer, durationMs, judge) {
  const coverage = extractCoverage(response);
  const { supported, claimCount, groundedRatio } = computeGroundedRatio(coverage);

  const actualTool = extractActualTool(response);
  const actualTier = inferTierFromTool(actualTool, response);

  const expectedTier = caseItem.expectedTier ?? null;
  const expectedTool = caseItem.expectedTool ?? null;

  const routingPassed =
    expectedTier === null && !expectedTool
      ? true
      : (expectedTier === null || Number(expectedTier) === Number(actualTier)) &&
        (!expectedTool || String(expectedTool) === String(actualTool));

  const mention = checkMustMention(answer, caseItem.mustMention);
  const acceptable = checkAcceptableAny(answer, caseItem.acceptableAny);
  const mentionAnyGroups = checkMustMentionAnyGroups(answer, caseItem.mustMentionAnyGroups);
  const forbidden = checkMustNotClaim(answer, caseItem.mustNotClaim);

  const mentionPassed =
    (acceptable.enabled ? acceptable.passed : mention.passed) &&
    (!mentionAnyGroups.enabled || mentionAnyGroups.passed);

  const minGroundedRatio = Number(caseItem.minGroundedRatio ?? 0);
  const maxLatencyMs = Number(caseItem.maxLatencyMs ?? 180_000);

  const groundedPassed =
    minGroundedRatio <= 0 ? true : groundedRatio >= minGroundedRatio;

  const latencyPassed = durationMs <= maxLatencyMs;
  const correctnessPassed = judge.correctness >= Number(caseItem.minCorrectness ?? 0.7);
  const completenessPassed = judge.completeness >= Number(caseItem.minCompleteness ?? 0.7);

  const failures = [];

  if (!routingPassed) failures.push(`routing expected tier/tool ${expectedTier}/${expectedTool}, got ${actualTier}/${actualTool}`);
  if (!groundedPassed) failures.push(`groundedRatio ${groundedRatio.toFixed(2)} < ${minGroundedRatio}`);
  if (!mentionPassed) {
    const groupFailures = mentionAnyGroups.enabled
      ? mentionAnyGroups.missingGroups
          .map((group) => `[${group.join(" OR ")}]`)
          .join(", ")
      : "";

    failures.push(
      `missing mustMention: ${mention.missing.join(", ")} ${groupFailures}`.trim(),
    );
  }
  if (!forbidden.passed) failures.push(`mustNotClaim violations: ${forbidden.violations.join(", ")}`);
  if (!latencyPassed) failures.push(`latency ${durationMs} > ${maxLatencyMs}`);
  if (!correctnessPassed) failures.push(`correctness ${judge.correctness.toFixed(2)} too low`);
  if (!completenessPassed) failures.push(`completeness ${judge.completeness.toFixed(2)} too low`);

  const phase2 = checkExpectedPhase2(caseItem, response);
  if (!phase2.passed) {
    failures.push(`phase2 signals: ${phase2.failures.join(", ")}`);
  }

  return {
    id: caseItem.id,
    intent: caseItem.intent ?? "",
    query: caseItem.query,
    expectedTier,
    actualTier,
    expectedTool,
    actualTool,
    minGroundedRatio: Number(caseItem.minGroundedRatio ?? 0),
    maxLatencyMs: Number(caseItem.maxLatencyMs ?? 180_000),
    routingPassed,
    groundedRatio,
    supportedClaimCount: supported,
    claimCount,
    correctness: judge.correctness,
    completeness: judge.completeness,
    judgeMode: judge.mode,
    mustMentionPassed: mentionPassed,
    mustMentionHits: mention.hits,
    mustMentionMissing: mention.missing,
    mustMentionAnyGroupsPassed: mentionAnyGroups.enabled
      ? mentionAnyGroups.passed
      : true,
    mustMentionAnyGroupsMissing: mentionAnyGroups.missingGroups,
    acceptableAnyHits: acceptable.hits,
    mustNotClaimPassed: forbidden.passed,
    mustNotClaimViolations: forbidden.violations,
    latencyPassed,
    durationMs,
    phase2Signals: phase2.signals,
    phase2Passed: phase2.passed,
    passed: failures.length === 0,
    failures: failures.join("; "),
    answerPreview: answer.slice(0, 1000),
  };
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  let cases = await loadCases();
  const caseFilter = parseCaseIdsFilter();
  if (caseFilter) {
    cases = cases.filter((caseItem) => caseMatchesFilter(caseItem, caseFilter));
    console.log(`Case filter: ${process.env.EVAL_CASE_IDS} → ${cases.length} cases`);
  }
  const startedAt = new Date().toISOString();

  console.log(`Running ${cases.length} eval cases`);
  console.log(`Target: ${EVAL_TARGET}`);
  console.log(`Project: ${PROJECT_ID}`);
  console.log(`Output: ${OUTPUT_DIR}`);

  const rows = [];

  for (const [index, caseItem] of cases.entries()) {
    const started = Date.now();
    const id = caseItem.id || `case-${index + 1}`;
    const responsePath = path.join(OUTPUT_DIR, `${String(index + 1).padStart(2, "0")}-${id}.json`);

    console.log(`\n[${index + 1}/${cases.length}] ${id}`);
    console.log(caseItem.query);

    let response = null;
    let answer = "";
    let judge = {
      correctness: 0,
      completeness: 0,
      missing: [],
      errors: [],
      mode: "not_run",
    };

    try {
      response = await callScout(caseItem);
      answer = extractAnswer(response);
      judge = await judgeWithModel(caseItem, answer);

      const durationMs = Date.now() - started;
      const row = evaluateCase(caseItem, response, answer, durationMs, judge);

      const rewardResult = computeReward(row);
      row.reward = rewardResult.reward;
      row.rewardReasons = rewardResult.reasons;

      const trajectory = buildTrajectory({
        caseItem,
        response,
        row,
      });

      const trajectoryPath = path.join(
        OUTPUT_DIR,
        `${String(index + 1).padStart(2, "0")}-${id}.trajectory.json`,
      );

      rows.push(row);

      await Promise.all([
        fs.writeFile(
          responsePath,
          JSON.stringify({ case: caseItem, row, judge, response }, null, 2),
        ),
        fs.writeFile(trajectoryPath, JSON.stringify(trajectory, null, 2)),
      ]);

      console.log(
        `${row.passed ? "PASS" : "FAIL"} | reward=${row.reward} | tier=${row.actualTier}/${row.expectedTier} | tool=${row.actualTool}/${row.expectedTool} | grounded=${row.groundedRatio.toFixed(2)} | correct=${row.correctness.toFixed(2)} | complete=${row.completeness.toFixed(2)} | ${row.failures}`,
      );
    } catch (error) {
      const durationMs = Date.now() - started;
      const message = error instanceof Error ? error.message : String(error);

      const row = {
        id,
        intent: caseItem.intent ?? "",
        query: caseItem.query,
        expectedTier: caseItem.expectedTier ?? null,
        actualTier: null,
        expectedTool: caseItem.expectedTool ?? null,
        actualTool: null,
        minGroundedRatio: Number(caseItem.minGroundedRatio ?? 0),
        maxLatencyMs: Number(caseItem.maxLatencyMs ?? 180_000),
        routingPassed: false,
        groundedRatio: 0,
        supportedClaimCount: 0,
        claimCount: 0,
        correctness: 0,
        completeness: 0,
        judgeMode: "not_run",
        mustMentionPassed: false,
        mustMentionHits: [],
        mustMentionMissing: safeArray(caseItem.mustMention),
        mustNotClaimPassed: true,
        mustNotClaimViolations: [],
        latencyPassed: durationMs <= Number(caseItem.maxLatencyMs ?? 180_000),
        durationMs,
        passed: false,
        failures: `request_error:${message}`,
        answerPreview: "",
      };

      const rewardResult = computeReward(row);
      row.reward = rewardResult.reward;
      row.rewardReasons = rewardResult.reasons;

      const trajectoryPath = path.join(
        OUTPUT_DIR,
        `${String(index + 1).padStart(2, "0")}-${id}.trajectory.json`,
      );

      rows.push(row);

      await Promise.all([
        fs.writeFile(
          responsePath,
          JSON.stringify({ case: caseItem, error: message }, null, 2),
        ),
        fs.writeFile(
          trajectoryPath,
          JSON.stringify(
            {
              caseId: id,
              query: caseItem.query,
              expected: {
                tier: caseItem.expectedTier,
                tool: caseItem.expectedTool,
              },
              trajectory: [
                { type: "route_decision", tier: null, tool: null, reason: null },
                { type: "tool_result", tool: null, status: "error", citations: [], evidenceCoverage: {} },
                { type: "critic_verdict", verdict: null, score: null },
                { type: "final_answer", answerPreview: "" },
              ],
              metrics: {
                passed: false,
                routingPassed: false,
                groundedRatio: 0,
                correctness: 0,
                completeness: 0,
                latencyMs: durationMs,
                failures: `request_error:${message}`,
              },
            },
            null,
            2,
          ),
        ),
      ]);

      console.log(`FAIL | reward=${row.reward} | ${message}`);
    }
  }

  const finishedAt = new Date().toISOString();

  const routingPassed = rows.filter((row) => {
    const expectedTier = row.expectedTier;
    const expectedTool = row.expectedTool;
    if (expectedTier === null && !expectedTool) return true;
    const actualTier = row.actualTier;
    const actualTool = row.actualTool;
    return (
      (expectedTier === null || Number(expectedTier) === Number(actualTier)) &&
      (!expectedTool || String(expectedTool) === String(actualTool))
    );
  }).length;

  const aggregate = {
    startedAt,
    finishedAt,
    target: EVAL_TARGET,
    projectId: PROJECT_ID,
    total: rows.length,
    passed: rows.filter((row) => row.passed).length,
    failed: rows.filter((row) => !row.passed).length,
    passRate: rows.length ? rows.filter((row) => row.passed).length / rows.length : 0,
    routingAccuracy: rows.length ? routingPassed / rows.length : 0,
    meanGroundedRatio: rows.length ? rows.reduce((sum, row) => sum + row.groundedRatio, 0) / rows.length : 0,
    meanCorrectness: rows.length ? rows.reduce((sum, row) => sum + row.correctness, 0) / rows.length : 0,
    meanCompleteness: rows.length ? rows.reduce((sum, row) => sum + row.completeness, 0) / rows.length : 0,
    meanLatencyMs: rows.length ? rows.reduce((sum, row) => sum + row.durationMs, 0) / rows.length : 0,
    meanReward: rows.length ? rows.reduce((sum, row) => sum + Number(row.reward ?? 0), 0) / rows.length : 0,
  };

  const summary = { aggregate, rows };

  await fs.writeFile(path.join(OUTPUT_DIR, "eval.json"), JSON.stringify(summary, null, 2));
  await fs.writeFile(path.join(OUTPUT_DIR, "summary.csv"), rowsToCsv(rows));
  await fs.writeFile(path.join(OUTPUT_DIR, "summary.md"), rowsToMarkdown(rows, aggregate));

  console.log("\nEval complete.");
  console.log(`Passed: ${aggregate.passed}/${aggregate.total}`);
  console.log(`Mean grounded ratio: ${aggregate.meanGroundedRatio.toFixed(3)}`);
  console.log(`Mean correctness: ${aggregate.meanCorrectness.toFixed(3)}`);
  console.log(`Mean completeness: ${aggregate.meanCompleteness.toFixed(3)}`);
  console.log(`Mean reward: ${aggregate.meanReward.toFixed(1)}`);
  console.log(`Routing accuracy: ${(aggregate.routingAccuracy * 100).toFixed(0)}%`);
  console.log(`Summary: ${path.join(OUTPUT_DIR, "summary.md")}`);

  let gateFailed = false;

  if (FAIL_UNDER > 0 && aggregate.meanCorrectness < FAIL_UNDER) {
    console.error(`GATE: meanCorrectness ${aggregate.meanCorrectness.toFixed(3)} < ${FAIL_UNDER}`);
    gateFailed = true;
  }

  const GATE_MIN_PASS_RATE = Number(process.env.EVAL_GATE_PASS_RATE || 0);
  if (GATE_MIN_PASS_RATE > 0 && aggregate.passRate < GATE_MIN_PASS_RATE) {
    console.error(`GATE: passRate ${aggregate.passRate.toFixed(3)} < ${GATE_MIN_PASS_RATE}`);
    gateFailed = true;
  }

  const GATE_MIN_REWARD = Number(process.env.EVAL_GATE_MIN_REWARD || 0);
  if (GATE_MIN_REWARD > 0 && aggregate.meanReward < GATE_MIN_REWARD) {
    console.error(`GATE: meanReward ${aggregate.meanReward.toFixed(1)} < ${GATE_MIN_REWARD}`);
    gateFailed = true;
  }

  const GATE_MIN_ROUTING = Number(process.env.EVAL_GATE_ROUTING || 0);
  if (GATE_MIN_ROUTING > 0 && aggregate.routingAccuracy < GATE_MIN_ROUTING) {
    console.error(`GATE: routingAccuracy ${(aggregate.routingAccuracy * 100).toFixed(0)}% < ${(GATE_MIN_ROUTING * 100).toFixed(0)}%`);
    gateFailed = true;
  }

  if (gateFailed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
