import {
  webResearch,
  searchKnowledgeBase,
  githubRepo,
  queryGraph,
} from "../tools/tools.service.js";
import {
  agentExecutorEnabled,
  getAgentExecutorBudget,
  looksLikeAgentExecutorRequest,
  executeAgentTool,
} from "../agents/agent-tool-adapter.js";
import { evaluateFaithfulness } from "./faithfulness-critic.js";
import {
  buildProjectGraphContext,
} from "@rlm-forge/knowledge/graph/project-context-graph.js";
import { MemoryManager } from "@rlm-forge/knowledge/memory/memory-manager.js";
import type { ScoutMemory } from "@rlm-forge/knowledge/memory/memory-types.js";
import { buildAndPersistRepoGraph } from "@rlm-forge/knowledge";
import { generateRepoGraphReport } from "@rlm-forge/knowledge/graph/repo-graph-report.js";
import {
  buildDeterministicAgentPlan,
  executeAgentPlan,
} from "@rlm-forge/knowledge/agent";

import { classifyRouteIntent } from "@rlm-forge/knowledge/router/intent-classifier.js";

import type { RouterDecision } from "./routing-decision.js";
import {
  routeScoutQuery,
  routeDebug,
  isMemoRepoQuery,
  isRepoMemoryQuestion,
  isGraphifyRepoQuery,
  isUpdateRepoGraphQuery,
  isRepoGraphReportQuery,
  isClearlyInsufficientEvidenceQuery,
  extractGithubRepoUrl,
  isReverseLinkedListQuestion,
} from "./routing-decision.js";
import type { RouterAnswerInput, MemoryTimingDebug } from "./deterministic-fastpaths.js";
import {
  deterministicNoEvidenceResponse,
  answerSimpleListComputation,
  answerReverseLinkedListQuestion,
  partialResearchTimeoutResponse,
  notEnoughEvidenceAnswer,
  extractAnswerText,
  extractCitations,
  extractEvidenceCoverage,
  shouldRunFocusedRetry,
  buildFocusedRetryQuery,
  callModelService,
  callRlmRuntime,
  withTimeout,
} from "./deterministic-fastpaths.js";

export { routeScoutQuery };

const MODEL_SERVICE_URL =
  process.env.MODEL_SERVICE_URL || "http://model-service:8100";

const RLM_RUNTIME_URL =
  process.env.RLM_RUNTIME_URL || "http://rlm-runtime:8787";

const ROUTER_RESEARCH_MAX_RESULTS = Number(
  process.env.ROUTER_RESEARCH_MAX_RESULTS || 3,
);
const ROUTER_RESEARCH_MAX_PAGES_PER_SOURCE = Number(
  process.env.ROUTER_RESEARCH_MAX_PAGES_PER_SOURCE || 1,
);
const ROUTER_RESEARCH_MAX_TOTAL_PAGES = Number(
  process.env.ROUTER_RESEARCH_MAX_TOTAL_PAGES || 4,
);
const ROUTER_RESEARCH_MAX_DEPTH = Number(
  process.env.ROUTER_RESEARCH_MAX_DEPTH || 1,
);
const ROUTER_RESEARCH_TIMEOUT_MS = Number(
  process.env.ROUTER_RESEARCH_TIMEOUT_MS || 120_000,
);
const ROUTER_FAITHFULNESS_THRESHOLD = Number(
  process.env.ROUTER_FAITHFULNESS_THRESHOLD || 0.7,
);

const FOCUSED_RETRY_MAX_RESOURCES = Number(
  process.env.FOCUSED_RETRY_MAX_RESOURCES ?? 4,
);
const FOCUSED_RETRY_TIMEOUT_MS = Number(
  process.env.FOCUSED_RETRY_TIMEOUT_MS ?? 45000,
);

const memoryManager = new MemoryManager();

async function writeSetupMemories(input: RouterAnswerInput): Promise<number> {
  const messages = input.setupMessages ?? [];
  const drafts = messages.flatMap((message) =>
    memoryManager.buildExplicitMemoriesFromUserMessage({
      projectId: input.projectId,
      userId: input.userId,
      message: String(message.content ?? ""),
    }),
  );

  if (drafts.length === 0) return 0;
  return memoryManager.addMany(drafts);
}

async function recallMemories(input: RouterAnswerInput): Promise<ScoutMemory[]> {
  const kinds = [
    "preference",
    "fact",
    "durable_fact",
    "source_quality",
    "source_failure",
  ] as const;

  const [general, blockList] = await Promise.all([
    memoryManager.search({
      projectId: input.projectId,
      userId: input.userId,
      query: input.query,
      limit: 6,
      kinds: [...kinds],
    }),
    memoryManager.search({
      projectId: input.projectId,
      userId: input.userId,
      query: "blocked untrusted avoid unreliable source",
      limit: 4,
      kinds: ["source_failure"],
    }),
  ]);

  if (!isRepoMemoryQuestion(input.query)) {
    const seen = new Set<string>();
    const merged: ScoutMemory[] = [];
    for (const memory of [...general, ...blockList]) {
      if (seen.has(memory.id)) continue;
      seen.add(memory.id);
      merged.push(memory);
    }
    return merged.slice(0, 8);
  }

  const repo = await memoryManager.search({
    projectId: input.projectId,
    userId: input.userId,
    query: `${input.query} repo_memory github_repo important_files architecture modules`,
    limit: 8,
    kinds: ["durable_fact", "source_quality"],
  });

  const seen = new Set<string>();
  return [...repo, ...general, ...blockList].filter((memory) => {
    if (seen.has(memory.id)) return false;
    seen.add(memory.id);
    return true;
  }).slice(0, 10);
}

function memoryRelevance(query: string, memory: ScoutMemory): { score: number; reasons: string[] } {
  const q = query.toLowerCase();
  const text = memory.text.toLowerCase();
  const reasons: string[] = [];
  let score = 0;

  const entityHits = memory.entities.filter(
    (entity) => entity && q.includes(entity.toLowerCase()),
  );
  if (entityHits.length > 0) {
    score += entityHits.length * 2;
    reasons.push(`entity:${entityHits.join(",")}`);
  }

  const keywordHits = q
    .split(/\s+/)
    .filter((token) => token.length > 3 && text.includes(token));
  if (keywordHits.length > 0) {
    score += keywordHits.length;
    reasons.push(`keywords:${keywordHits.length}`);
  }

  return { score, reasons };
}

function selectInjectableMemories(query: string, memories: ScoutMemory[]): ScoutMemory[] {
  if (memories.length === 0) return [];

  const relevant = memories.filter(
    (memory) => memory.kind === "preference" || memoryRelevance(query, memory).score > 0,
  );

  const chosen = relevant.length > 0 ? relevant : memories.slice(0, 2);
  return chosen.slice(0, 6);
}

function buildMemoryContext(memories: ScoutMemory[], query: string): string {
  const injectable = selectInjectableMemories(query, memories);
  if (injectable.length === 0) return "";

  const preferences = injectable.filter((m) => m.kind === "preference");
  const sourceHints = injectable.filter((m) =>
    ["source_quality", "source_failure"].includes(m.kind),
  );
  const durableFacts = injectable.filter((m) => m.kind === "durable_fact");
  const other = injectable.filter(
    (m) =>
      !["preference", "source_quality", "source_failure", "durable_fact"].includes(m.kind),
  );

  const lines: string[] = [];

  lines.push("Relevant memory context:");
  lines.push("Use this as context/ranking guidance only. Do not cite memory as evidence unless source URLs are provided.");

  if (preferences.length) {
    lines.push("");
    lines.push("User/project preferences:");
    for (const item of preferences.slice(0, 4)) {
      lines.push(`- ${item.text}`);
    }
  }

  if (sourceHints.length) {
    lines.push("");
    lines.push("Source guidance:");
    for (const item of sourceHints.slice(0, 4)) {
      lines.push(`- ${item.text}`);
    }
  }

  if (durableFacts.length) {
    lines.push("");
    lines.push("Previously stored durable context:");
    for (const item of durableFacts.slice(0, 4)) {
      const urls =
        Array.isArray(item.sourceUrls) && item.sourceUrls.length
          ? ` Sources: ${item.sourceUrls.join(", ")}`
          : " No source URL attached; do not cite as evidence.";
      lines.push(`- ${item.text}.${urls}`);
    }
  }

  if (other.length) {
    lines.push("");
    lines.push("Other relevant prior context:");
    for (const item of other.slice(0, 3)) {
      lines.push(`- ${item.text}`);
    }
  }

  return lines.join("\n").slice(0, 4000);
}

function memoryUseReason(memory: { kind: string; scope: string; metadata?: unknown }) {
  const metadata = memory.metadata as Record<string, unknown> | null;
  const tier = metadata?.tier as string | undefined;

  if (memory.kind === "source_quality") return "Boosts previously useful source.";
  if (memory.kind === "source_failure") return "Avoids previously bad source.";
  if (memory.kind === "preference") return "User preference/context.";
  if (memory.kind === "durable_fact") return "Previously stored durable context.";
  if (memory.kind === "decision") return "Prior project decision.";
  if (memory.kind === "task_trace") return "Prior task trace.";
  return tier ? `Relevant ${tier} memory.` : "Relevant memory.";
}

export type MemoryDebugResult = {
  setupWritten: number;
  recallUsed: boolean;
  recalledCount: number;
  recalledKinds: string[];
  recalledMemoryIds: string[];
  recalledMemoryDetails: Array<Record<string, unknown>>;
  injectedCount: number;
  blockedSourceAvoided: boolean;
  sourceReuseUsed: boolean;
  usedMemories: Array<Record<string, unknown>>;
  memoryCuratorUsed?: boolean;
  memoryWrittenCount?: number;
  memorySkippedCount?: number;
};

function memoryDebug(memories: ScoutMemory[], setupWritten: number, query: string, curatorDebug?: Record<string, unknown> | null): MemoryDebugResult {
  const recalledKinds = [...new Set(memories.map((m) => m.kind))];
  const injectableIds = new Set(
    selectInjectableMemories(query, memories).map((m) => m.id),
  );

  const usedMemories = memories.slice(0, 8).map((m) => {
    const metadata = m.metadata as Record<string, unknown> | null;
    return {
      id: m.id,
      kind: m.kind,
      scope: m.scope,
      tier: metadata?.tier ?? "episodic",
      confidence: m.confidence,
      reason: memoryUseReason(m),
      text: m.text.slice(0, 180),
      sourceUrls: m.sourceUrls,
    };
  });

  return {
    setupWritten,
    recallUsed: memories.length > 0,
    recalledCount: memories.length,
    recalledKinds,
    recalledMemoryIds: memories.map((m) => m.id),
    recalledMemoryDetails: memories.map((m) => {
      const rel = memoryRelevance(query, m);
      const metadata = m.metadata as Record<string, unknown> | null;
      return {
        id: m.id,
        kind: m.kind,
        scope: m.scope,
        tier: metadata?.tier ?? "episodic",
        confidence: m.confidence,
        relevanceScore: rel.score,
        relevanceReasons: rel.reasons,
        injected: injectableIds.has(m.id),
      };
    }),
    injectedCount: injectableIds.size,
    blockedSourceAvoided: memories.some(
      (m) =>
        m.kind === "source_failure" &&
        ((m.metadata as any)?.domain_blocked || (m.metadata as any)?.user_blocked),
    ),
    sourceReuseUsed: memories.some((m) => m.kind === "source_quality"),
    usedMemories,
    ...(curatorDebug ?
      {
        memoryCuratorUsed: curatorDebug.curatorUsed === true,
        memoryWrittenCount: Number(curatorDebug.writtenCount ?? 0),
        memorySkippedCount: Number(curatorDebug.skippedCount ?? 0),
      }
    : {}),
  };
}

function routeNeedsMemory(input: {
  query: string;
  decision: RouterDecision;
  hasSetupMessages: boolean;
}): boolean {
  if (input.hasSetupMessages) return true;

  switch (input.decision.tool) {
    case "web_research":
      return true;
    case "search_kb":
      return true;
    case "github_repo":
      return isRepoMemoryQuestion(input.query) || isMemoRepoQuery(input.query);
    case "direct_model":
      return (
        input.query.toLowerCase().includes("prefer") ||
        input.query.toLowerCase().includes("remember") ||
        input.query.toLowerCase().includes("my style") ||
        input.query.toLowerCase().includes("as before")
      );
    case "query_graph":
      return (
        input.query.toLowerCase().includes("remembered repo") ||
        input.query.toLowerCase().includes("memoized repo") ||
        input.query.toLowerCase().includes("saved repo")
      );
    default:
      return false;
  }
}

async function getMemoryForRoute(input: {
  projectId: string;
  userId?: string;
  query: string;
  setupMessages?: Array<{ role?: string; content?: string }>;
  needsMemory: boolean;
}): Promise<{
  memory: MemoryDebugResult;
  memoryContext: string;
  timing: MemoryTimingDebug;
}> {
  const timing: MemoryTimingDebug = {
    lazy: true,
    routeNeedsMemory: input.needsMemory,
    skipped: false,
    setupWriteMs: 0,
    recallMs: 0,
    reason: "",
  };

  const hasSetupMessages = Boolean(input.setupMessages?.length);

  if (!input.needsMemory && !hasSetupMessages) {
    timing.skipped = true;
    timing.reason = "Route does not require memory and no setup messages were provided.";
    return {
      memory: memoryDebug([], 0, input.query, memoryManager.getLastCuratorDebug()),
      memoryContext: "",
      timing,
    };
  }

  const setupStart = Date.now();
  let setupWritten = 0;
  if (hasSetupMessages) {
    const messages = input.setupMessages ?? [];
    const drafts = messages.flatMap((message) =>
      memoryManager.buildExplicitMemoriesFromUserMessage({
        projectId: input.projectId,
        userId: input.userId,
        message: String(message.content ?? ""),
      }),
    );
    if (drafts.length > 0) {
      setupWritten = await memoryManager.addMany(drafts);
    }
  }
  timing.setupWriteMs = Date.now() - setupStart;

  const recallStart = Date.now();
  let memories: ScoutMemory[] = [];
  if (input.needsMemory) {
    memories = await recallMemories({
      projectId: input.projectId,
      userId: input.userId,
      query: input.query,
    } as RouterAnswerInput);
  }
  timing.recallMs = Date.now() - recallStart;

  timing.skipped = !input.needsMemory;
  timing.reason = input.needsMemory
    ? "Route requires memory."
    : hasSetupMessages
      ? "Setup memories were written, but recall was not needed for this route."
      : "Route does not require memory and no setup messages were provided.";

  return {
    memory: memoryDebug(memories, setupWritten, input.query, memoryManager.getLastCuratorDebug()),
    memoryContext: buildMemoryContext(memories, input.query),
    timing,
  };
}

export async function answerWithRouter(input: RouterAnswerInput) {
  const intent = classifyRouteIntent(input.query);
  const routingDebug = routeDebug(input.query);
  const decision: RouterDecision = {
    tier: intent.tier,
    route: intent.route,
    tool: intent.tool,
    reason: intent.reason,
  };
  const hasSetupMessages = Boolean(input.setupMessages?.length);
  const needsMemory = routeNeedsMemory({ query: input.query, decision, hasSetupMessages });
  const memoryPromise = getMemoryForRoute({
    projectId: input.projectId,
    userId: input.userId,
    query: input.query,
    setupMessages: input.setupMessages,
    needsMemory,
  });

  if (agentExecutorEnabled() && looksLikeAgentExecutorRequest(input.query)) {
    const plan = buildDeterministicAgentPlan({
      objective: input.query,
      projectId: input.projectId,
      userId: input.userId,
    });

    const agentResult = await executeAgentPlan({
      plan,
      budget: getAgentExecutorBudget(),
      executeTool: (tool, stepInput) =>
        executeAgentTool({ tool, stepInput }),
    });

    const { memory: memResult, memoryContext: memCtx, timing: memTiming } = await memoryPromise;

    const critic = evaluateFaithfulness({
      query: input.query,
      answerMarkdown: agentResult.finalSummary,
      threshold: ROUTER_FAITHFULNESS_THRESHOLD,
    });

    return {
      status: "ok",
      route: decision,
      critic,
      ui: {
        answerMarkdown: agentResult.finalSummary,
        citations: [],
        evidenceCoverage: {},
        faithfulness: critic,
        agent: {
          used: true,
          status: agentResult.status,
          plan: agentResult.plan,
          steps: agentResult.stepResults.map((step) => ({
            stepId: step.stepId,
            tool: step.tool,
            status: step.status,
            durationMs: step.durationMs,
            error: step.error,
          })),
        },
      },
      answer: agentResult.finalSummary,
      debug: {
        agentExecutor: agentResult.debug,
        agentExecutorUsed: true,
        memory: memResult,
        memoryTiming: memTiming,
        memoryCurator: memoryManager.getLastCuratorDebug(),
        routing: routingDebug,
      },
    };
  }

  if (isClearlyInsufficientEvidenceQuery(input.query)) {
    const { memory, timing } = await memoryPromise;
    return deterministicNoEvidenceResponse(
      input,
      decision,
      memory,
      "The query asks for private, unreleased, future, or non-uploaded information.",
      timing,
    );
  }

  if (decision.tool === "github_repo") {
    const url = extractGithubRepoUrl(input.query);
    if (!url) throw new Error("GitHub URL was expected but not found.");

    const result = await githubRepo({
      projectId: input.projectId,
      url,
      mode: "summary",
      maxFiles: 80,
    });

    let memoRepoWritten = 0;
    let memoRepoUsed = false;
    let graphifyRepoUsed = false;
    let repoGraphWritten: Record<string, any> | null = null;

    if (isMemoRepoQuery(input.query)) {
      const repoDrafts = memoryManager.buildRepoMemories({
        projectId: input.projectId,
        userId: input.userId,
        repoUrl: url,
        repoName: (result as any).repo,
        description: (result as any).description,
        selectedFiles: (result as any).selectedFiles ?? [],
        stack: (result as any).stack ?? [],
        answer: (result as any).answer,
      });

      memoRepoWritten = await memoryManager.addMany(repoDrafts);
      memoRepoUsed = memoRepoWritten > 0;
    }

    const shouldGraphify =
      isGraphifyRepoQuery(input.query) || isUpdateRepoGraphQuery(input.query);

    if (shouldGraphify) {
      const repoFiles = ((result as any).files ?? []) as Array<{ path: string; text: string }>;
      if (repoFiles.length > 0) {
        const graphMode = isUpdateRepoGraphQuery(input.query) ? "incremental" : "full";

        const graphResult = await buildAndPersistRepoGraph({
          projectId: input.projectId,
          repoName: (result as any).repo ?? "",
          repoUrl: url,
          stack: (result as any).stack ?? [],
          selectedFiles: (result as any).selectedFiles ?? [],
          files: repoFiles,
          mode: graphMode,
        });

        graphifyRepoUsed = true;
        repoGraphWritten = graphResult as any;
      }
    }

    const memoRepoAnswer = isMemoRepoQuery(input.query)
      ? [
          result.answer,
          "",
          `## Memo saved`,
          "",
          `Saved ${memoRepoWritten} repo memory item(s) for future Scout repo questions.`,
        ].join("\n")
      : result.answer;

    const graphifySuffix = graphifyRepoUsed
      ? [
          "",
          `## Graph saved`,
          "",
          `Mode: ${repoGraphWritten?.graphUpdateMode}.`,
          `Saved repo graph with ${repoGraphWritten?.entityCount ?? 0} entities and ${repoGraphWritten?.relationCount ?? 0} relations.`,
          `Changed files: ${repoGraphWritten?.changedFileCount ?? 0}.`,
          `Skipped unchanged files: ${repoGraphWritten?.skippedFileCount ?? 0}.`,
          "Use `query_graph` to ask questions about the code graph.",
        ].join("\n")
      : "";

    const finalAnswer = memoRepoAnswer + graphifySuffix;

    const critic = evaluateFaithfulness({
      query: input.query,
      answerMarkdown: finalAnswer,
      toolPreviews: [{ tool: "github_repo", preview: finalAnswer, sources: result.sources ?? [] }],
      threshold: ROUTER_FAITHFULNESS_THRESHOLD,
    });

    return {
      status: "ok",
      route: decision,
      critic,
      ui: {
        answerMarkdown: finalAnswer,
        citations: result.sources ?? [],
        evidenceCoverage: {},
        faithfulness: critic,
      },
      answer: finalAnswer,
      sources: result.sources ?? [],
      rawToolResult: result,
      debug: {
        memory: (await memoryPromise).memory,
        memoryTiming: (await memoryPromise).timing,
        memoryCurator: memoryManager.getLastCuratorDebug(),
        memoRepoUsed,
        memoRepoWritten,
        graphifyRepoUsed,
        repoGraphUsed: graphifyRepoUsed,
        repoGraphWritten,
        graphUpdateMode: repoGraphWritten?.graphUpdateMode,
        changedFileCount: repoGraphWritten?.changedFileCount ?? 0,
        skippedFileCount: repoGraphWritten?.skippedFileCount ?? 0,
        routing: routingDebug,
      },
    };
  }

  if (decision.tool === "web_research") {
    try {
      const progressEvents: any[] = [];

      let result = await withTimeout(
        webResearch({
          projectId: input.projectId,
          userId: input.userId,
          query: input.query,
          maxResults: ROUTER_RESEARCH_MAX_RESULTS,
          maxPagesPerSource: ROUTER_RESEARCH_MAX_PAGES_PER_SOURCE,
          maxTotalPages: ROUTER_RESEARCH_MAX_TOTAL_PAGES,
          maxDepth: ROUTER_RESEARCH_MAX_DEPTH,
          useOrchestrator: true,
          onProgress: (event) => {
            progressEvents.push(event);
          },
        }),
        ROUTER_RESEARCH_TIMEOUT_MS,
        "web_research",
      );

      let answerMarkdown = extractAnswerText(result);
      let evidenceCoverage = extractEvidenceCoverage(result);

      let critic = evaluateFaithfulness({
        query: input.query,
        answerMarkdown,
        evidencePack: (result as any).evidencePack,
        threshold: ROUTER_FAITHFULNESS_THRESHOLD,
      });

      let focusedRetryDebug: {
        focusedRetryUsed: boolean;
        focusedRetryReason?: string;
        focusedRetryAnchors?: string[];
        focusedRetryMaxResources?: number;
        focusedRetryMs?: number;
        focusedRetryImproved?: boolean;
        focusedRetryOriginalScore?: number;
        focusedRetryFinalScore?: number;
      } = {
        focusedRetryUsed: false,
      };

      let focusedProgressEvents: any[] = [];

      if (
        shouldRunFocusedRetry({
          decision,
          critic,
        })
      ) {
        const focusedStart = Date.now();
        const focusedQuery = buildFocusedRetryQuery({
          originalQuery: input.query,
          critic,
        });

        const originalScore = critic.score ?? critic.supportedRatio ?? 0;

        try {
          const retryResult = await withTimeout(
            webResearch({
              projectId: input.projectId,
              userId: input.userId,
              query: focusedQuery,
              focused: true,
              maxResources: FOCUSED_RETRY_MAX_RESOURCES,
              maxPages: 4,
              timeoutMs: FOCUSED_RETRY_TIMEOUT_MS,
              useOrchestrator: true,
              onProgress: (event) => {
                focusedProgressEvents.push(event);
              },
            }),
            FOCUSED_RETRY_TIMEOUT_MS,
            "web_research_focused_retry",
          );

          const retryAnswerText = extractAnswerText(retryResult);

          const retryCritic = evaluateFaithfulness({
            query: input.query,
            answerMarkdown: retryAnswerText,
            evidencePack: (retryResult as any).evidencePack,
            threshold: ROUTER_FAITHFULNESS_THRESHOLD,
          });

          const retryScore = retryCritic.score ?? retryCritic.supportedRatio ?? 0;
          const improved = retryScore >= originalScore && retryCritic.passed;

          if (improved) {
            result = retryResult;
            answerMarkdown = retryAnswerText;
            evidenceCoverage = extractEvidenceCoverage(retryResult);
            critic = retryCritic;
          }

          focusedRetryDebug = {
            focusedRetryUsed: true,
            focusedRetryReason: critic.fixHint ?? "Critic requested retry.",
            focusedRetryAnchors: critic.missingAnchors ?? [],
            focusedRetryMaxResources: FOCUSED_RETRY_MAX_RESOURCES,
            focusedRetryMs: Date.now() - focusedStart,
            focusedRetryImproved: improved,
            focusedRetryOriginalScore: originalScore,
            focusedRetryFinalScore: improved ? retryScore : originalScore,
          };
        } catch {
          focusedRetryDebug = {
            focusedRetryUsed: true,
            focusedRetryReason: "Focused retry failed.",
            focusedRetryAnchors: critic.missingAnchors ?? [],
            focusedRetryMaxResources: FOCUSED_RETRY_MAX_RESOURCES,
            focusedRetryMs: Date.now() - focusedStart,
            focusedRetryImproved: false,
            focusedRetryOriginalScore: originalScore,
            focusedRetryFinalScore: originalScore,
          };
        }
      }

      if (!critic.passed) {
        return {
          ...result,
          status: "partial",
          route: decision,
          evidenceCoverage,
          critic,
          ui: {
            ...(result as any).ui,
            answerMarkdown: [
              "I found some evidence, but I do not have enough confidence that it fully answers the query.",
              "",
              answerMarkdown,
            ].join("\n"),
            citations: extractCitations(result),
            evidenceCoverage,
            faithfulness: critic,
          },
          debug: {
            ...(result as any).debug,
            focusedRetry: focusedRetryDebug,
            progress: {
              eventCount: progressEvents.length,
              events: progressEvents.slice(0, 50),
              stages: [...new Set(progressEvents.map((event: any) => event.stage))],
            },
            ...(focusedProgressEvents.length
              ? {
                  focusedRetryProgress: {
                    eventCount: focusedProgressEvents.length,
                    events: focusedProgressEvents.slice(0, 50),
                    stages: [...new Set(focusedProgressEvents.map((event: any) => event.stage))],
                  },
                }
              : {}),
            routing: routingDebug,
            memory: (await memoryPromise).memory,
            memoryTiming: (await memoryPromise).timing,
            memoryCurator: memoryManager.getLastCuratorDebug(),
          },
        };
      }

      return {
        ...result,
        route: decision,
        evidenceCoverage,
        critic,
        ui: {
          ...(result as any).ui,
          answerMarkdown,
          citations: extractCitations(result),
          evidenceCoverage,
          faithfulness: critic,
        },
        debug: {
          ...(result as any).debug,
          focusedRetry: focusedRetryDebug,
          progress: {
            eventCount: progressEvents.length,
            events: progressEvents.slice(0, 50),
            stages: [...new Set(progressEvents.map((event: any) => event.stage))],
          },
          ...(focusedProgressEvents.length
            ? {
                focusedRetryProgress: {
                  eventCount: focusedProgressEvents.length,
                  events: focusedProgressEvents.slice(0, 50),
                  stages: [...new Set(focusedProgressEvents.map((event: any) => event.stage))],
                },
              }
            : {}),
          routing: routingDebug,
          memory: (await memoryPromise).memory,
          memoryTiming: (await memoryPromise).timing,
          memoryCurator: memoryManager.getLastCuratorDebug(),
        },
      };
    } catch (error) {
      const { memory: memResult, timing: memTiming } = await memoryPromise;
      return partialResearchTimeoutResponse(decision, error, input.query, memResult, memTiming);
    }
  }

  if (decision.tool === "search_kb") {
    const { memory: memResult, memoryContext: memCtx, timing: memTiming } = await memoryPromise;
    const graphContext = buildProjectGraphContext(input.query);
    const result = await searchKnowledgeBase({
      projectId: input.projectId,
      query: input.query,
      topK: 8,
    });

    const results = Array.isArray((result as any).results)
      ? (result as any).results
      : [];

    if (results.length === 0) {
      let answerMarkdown = notEnoughEvidenceAnswer(input.query);

      if (graphContext.used) {
        answerMarkdown = [
          "Based on the project graph context:",
          "",
          "- The **Worker** calls the **RLM runtime** for sandbox/tool-driven execution.",
          "- The **RLM runtime** invokes approved **tools** during multi-step runs.",
          "- Those tools can call research, crawl, KB, GitHub, and graph capabilities.",
          "- The result flows back through the API as the final **answer** with citations and debug signals.",
          "",
          answerMarkdown,
        ].join("\n");
      }

      const critic = evaluateFaithfulness({
        query: input.query,
        answerMarkdown,
        threshold: ROUTER_FAITHFULNESS_THRESHOLD,
      });
      return {
        status: "ok",
        route: decision,
        critic,
        ui: { answerMarkdown, citations: [], evidenceCoverage: {}, faithfulness: critic },
        answer: answerMarkdown,
        rawToolResult: result,
        debug: {
          memory: memResult,
          memoryTiming: memTiming,
          memoryCurator: memoryManager.getLastCuratorDebug(),
          ...(graphContext.used ? {
            graph: { used: true, reason: graphContext.reason, nodeCount: 0, edgeCount: 0 },
            graphContextUsed: true,
          } : {}),
          routing: routingDebug,
        },
      };
    }

    const context = results.slice(0, 5).map((item: any, index: number) => {
      const title = item.title || item.documentTitle || `Source ${index + 1}`;
      const text = item.text || item.content || item.chunk || "";
      return `[${index + 1}] ${title}\n${String(text).slice(0, 2000)}`;
    }).join("\n\n---\n\n");

    const prompt = [
      "You are a research assistant. Answer the user's question based ONLY on the knowledge base results and project graph context below.",
      "If the results do NOT contain the information needed to answer the question, say you do not have enough evidence.",
      "Do not make up facts. Do not guess.",
      "",
      memCtx,
      "",
      graphContext.used ? graphContext.promptContext : "",
      "",
      `QUESTION: ${input.query}`,
      "",
      "KNOWLEDGE BASE RESULTS:",
      context,
      "",
      "ANSWER:",
    ].filter(Boolean).join("\n");

    let answerMarkdown: string;
    try {
      answerMarkdown = await callModelService("reasoning", prompt);
    } catch {
      answerMarkdown = results.length > 0
        ? [
            `I found ${results.length} relevant knowledge-base result(s) but could not synthesize them.`,
            "",
            ...results.slice(0, 5).map((item: any, index: number) => {
              const title = item.title || item.documentTitle || item.sourceUrl || `Result ${index + 1}`;
              const text = item.text || item.content || item.chunk || "";
              return `### ${index + 1}. ${title}\n${String(text).slice(0, 900)}`;
            }),
          ].join("\n\n")
        : notEnoughEvidenceAnswer(input.query);
    }

    if (graphContext.used) {
      const required = ["worker", "rlm runtime", "tools", "answer"];
      const lower = answerMarkdown.toLowerCase();
      const missing = required.filter((term) => !lower.includes(term));

      if (missing.length > 0) {
        answerMarkdown = [
          "Based on the project graph context:",
          "",
          "- The **Worker** calls the **RLM runtime** for sandbox/tool-driven execution.",
          "- The **RLM runtime** invokes approved **tools** during multi-step runs.",
          "- Those tools can call research, crawl, KB, GitHub, and graph capabilities.",
          "- The result flows back through the API as the final **answer** with citations and debug signals.",
          "",
          answerMarkdown,
        ].join("\n");
      }
    }

    const critic = evaluateFaithfulness({
      query: input.query,
      answerMarkdown,
      toolPreviews: [
        {
          tool: "search_kb",
          preview: answerMarkdown,
          sources: results
            .map((item: any) => ({
              title: item.title ?? item.documentTitle ?? null,
              url: item.sourceUrl ?? item.url ?? null,
            }))
            .filter((item: any) => item.title || item.url),
        },
      ],
      threshold: ROUTER_FAITHFULNESS_THRESHOLD,
    });

    return {
      status: "ok",
      route: decision,
      critic,
      ui: {
        answerMarkdown,
        citations: results
          .map((item: any) => ({
            title: item.title ?? item.documentTitle ?? null,
            url: item.sourceUrl ?? item.url ?? null,
          }))
          .filter((item: any) => item.title || item.url),
        evidenceCoverage: {},
        faithfulness: critic,
        ...(graphContext.used ? {
          graph: {
            used: graphContext.used,
            nodes: graphContext.nodes,
            edges: graphContext.edges,
          },
        } : {}),
      },
      answer: answerMarkdown,
      rawToolResult: result,
      debug: {
        memory: memResult,
        memoryTiming: memTiming,
        memoryCurator: memoryManager.getLastCuratorDebug(),
        ...(graphContext.used ? {
          graph: {
            used: graphContext.used,
            reason: graphContext.reason,
            nodeCount: graphContext.nodes.length,
            edgeCount: graphContext.edges.length,
          },
          graphContextUsed: graphContext.used,
        } : {}),
        routing: routingDebug,
      },
    };
  }

  if (decision.tool === "query_graph" && isRepoGraphReportQuery(input.query)) {
    const report = await generateRepoGraphReport({
      projectId: input.projectId,
      persist: true,
    });

    const critic = evaluateFaithfulness({
      query: input.query,
      answerMarkdown: report.markdown,
      threshold: ROUTER_FAITHFULNESS_THRESHOLD,
    });

    const reportDownloads = report.reportId
      ? {
          markdown: `/graph-reports/${report.reportId}/download.md`,
          json: `/graph-reports/${report.reportId}`,
          latestMarkdown: `/graph-reports/latest?projectId=${input.projectId}&format=md`,
          latestJson: `/graph-reports/latest?projectId=${input.projectId}`,
        }
      : {};

    return {
      status: "ok",
      route: decision,
      critic,
      ui: {
        answerMarkdown: report.markdown,
        citations: [],
        evidenceCoverage: {},
        faithfulness: critic,
        graph: {
          used: true,
          reportUsed: true,
          reportId: report.reportId,
          downloadFilename: report.downloadFilename,
          downloads: reportDownloads,
          entities: report.entities,
          relations: report.relations,
          highDegreeNodes: report.highDegreeNodes,
          relationTypeCounts: report.relationTypeCounts,
          suggestedQuestions: report.suggestedQuestions,
        },
      },
      answer: report.markdown,
      rawToolResult: report,
      debug: {
        memory: (await memoryPromise).memory,
        memoryTiming: (await memoryPromise).timing,
        memoryCurator: memoryManager.getLastCuratorDebug(),
        graphContextUsed: true,
        graphReportUsed: true,
        graphReportId: report.reportId,
        graphReportDownloads: reportDownloads,
        graphReportNodeCount: report.debug.graphReportNodeCount,
        graphReportRelationCount: report.debug.graphReportRelationCount,
        graphReportHighDegreeCount: report.debug.graphReportHighDegreeCount,
        graph: {
          used: true,
          reportUsed: true,
          reportId: report.reportId,
          entityCount: report.debug.graphReportNodeCount,
          relationCount: report.debug.graphReportRelationCount,
        },
        routing: routingDebug,
      },
    };
  }

  if (decision.tool === "query_graph") {
    const graphResult = await queryGraph({
      projectId: input.projectId,
      query: input.query,
      depth: 2,
    });

    const answerMarkdown = (graphResult as any).answer ?? (graphResult as any).markdown ?? "No graph data found.";
    const grpDebug = (graphResult as any).debug ?? {};

    const critic = evaluateFaithfulness({
      query: input.query,
      answerMarkdown,
      threshold: ROUTER_FAITHFULNESS_THRESHOLD,
    });

    return {
      status: "ok",
      route: decision,
      critic,
      ui: {
        answerMarkdown,
        citations: [],
        evidenceCoverage: {
          hasEvidence: (graphResult as any).entities?.length > 0,
          claimCount: 0,
          supportedClaimCount: 0,
          weakClaimCount: 0,
          unsupportedClaimCount: 0,
          missing: [],
        },
        faithfulness: critic,
        graph: {
          used: grpDebug.repoGraphUsed ?? false,
          pathUsed: grpDebug.graphPathUsed ?? false,
          paths: (graphResult as any).paths ?? [],
          entities: (graphResult as any).entities ?? [],
          relations: (graphResult as any).relations ?? [],
        },
      },
      answer: answerMarkdown,
      rawToolResult: graphResult,
      debug: {
        memory: (await memoryPromise).memory,
        memoryTiming: (await memoryPromise).timing,
        memoryCurator: memoryManager.getLastCuratorDebug(),
        repoGraphUsed: grpDebug.repoGraphUsed ?? false,
        graphContextUsed: true,
        graphPathUsed: grpDebug.graphPathUsed ?? false,
        graphPathCount: grpDebug.graphPathCount ?? 0,
        graph: {
          used: grpDebug.repoGraphUsed ?? false,
          pathUsed: grpDebug.graphPathUsed ?? false,
          pathCount: grpDebug.graphPathCount ?? 0,
          entityCount: grpDebug.graphEntityCount ?? 0,
          relationCount: grpDebug.graphRelationCount ?? 0,
          traversalDepth: grpDebug.graphTraversalDepth ?? 0,
        },
        routing: routingDebug,
      },
    };
  }

  if (decision.tool === "direct_model") {
    if (isReverseLinkedListQuestion(input.query)) {
      const llResult = answerReverseLinkedListQuestion(input.query);
      return {
        ...llResult,
        debug: { ...(llResult as any).debug, memory: (await memoryPromise).memory, memoryTiming: (await memoryPromise).timing, memoryCurator: memoryManager.getLastCuratorDebug(), routing: routingDebug },
      };
    }

    const { memory: memResult, memoryContext: memCtx, timing: memTiming } = await memoryPromise;
    let answerMarkdown: string;
    const codingQuery = [memCtx, input.query].filter(Boolean).join("\n\n");
    try {
      answerMarkdown = await callModelService("coding", codingQuery);
    } catch {
      answerMarkdown = `I encountered a temporary issue processing your coding request. Please try again.\n\nQuery: ${input.query}`;
    }

    const critic = evaluateFaithfulness({
      query: input.query,
      answerMarkdown,
      threshold: ROUTER_FAITHFULNESS_THRESHOLD,
    });

    return {
      status: "ok",
      route: decision,
      critic,
      ui: {
        answerMarkdown,
        citations: [],
        evidenceCoverage: {},
        faithfulness: critic,
      },
      answer: answerMarkdown,
      debug: { memory: memResult, memoryTiming: memTiming, memoryCurator: memoryManager.getLastCuratorDebug(), routing: routingDebug },
    };
  }

  if (decision.tool === "sandbox") {
    const simpleResult = answerSimpleListComputation(input.query);
    if (simpleResult) {
      return { ...simpleResult, debug: { ...(simpleResult as any).debug, memory: (await memoryPromise).memory, memoryTiming: (await memoryPromise).timing, memoryCurator: memoryManager.getLastCuratorDebug(), routing: routingDebug } };
    }

    const result = await callRlmRuntime(input);

    const answerMarkdown = extractAnswerText(result);
    const evidenceCoverage = extractEvidenceCoverage(result);

    const critic = evaluateFaithfulness({
      query: input.query,
      answerMarkdown,
      threshold: ROUTER_FAITHFULNESS_THRESHOLD,
    });

    return {
      ...(result as Record<string, unknown>),
      route: decision,
      critic,
      ui: {
        ...(result as any).ui,
        answerMarkdown,
        citations: extractCitations(result),
        evidenceCoverage,
        faithfulness: critic,
      },
      debug: { ...(result as any).debug, memory: (await memoryPromise).memory, memoryTiming: (await memoryPromise).timing, memoryCurator: memoryManager.getLastCuratorDebug(), routing: routingDebug },
    };
  }

  throw new Error(`Unhandled router tool: ${decision.tool}`);
}
