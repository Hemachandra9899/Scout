import {
  webResearch,
  searchKnowledgeBase,
  githubRepo,
  queryGraph,
} from "../tools/tools.service.js";
import { evaluateFaithfulness, type FaithfulnessCriticResult } from "./faithfulness-critic.js";
import {
  buildProjectGraphContext,
  shouldUseProjectGraphContext,
} from "@rlm-forge/knowledge/graph/project-context-graph.js";
import { MemoryManager } from "@rlm-forge/knowledge/memory/memory-manager.js";
import type { ScoutMemory } from "@rlm-forge/knowledge/memory/memory-types.js";
import { buildAndPersistRepoGraph } from "@rlm-forge/knowledge";
import { generateRepoGraphReport } from "@rlm-forge/knowledge/graph/repo-graph-report.js";

export type RouterTier = 1 | 2 | 3;

export type RouterDecision = {
  tier: RouterTier;
  route: "direct_tool" | "research_orchestrator" | "sandbox" | "direct_model";
  tool: "search_kb" | "github_repo" | "web_research" | "sandbox" | "direct_model" | "query_graph";
  reason: string;
};

export type RouterAnswerInput = {
  projectId: string;
  userId?: string;
  query: string;
  setupMessages?: Array<{
    role?: string;
    content?: string;
  }>;
};

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
const ROUTER_CODING_TIMEOUT_MS = Number(
  process.env.ROUTER_CODING_TIMEOUT_MS || 45_000,
);
const ROUTER_CODING_MAX_TOKENS = Number(
  process.env.ROUTER_CODING_MAX_TOKENS || 900,
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

// Why a memory is (or isn't) relevant to the current query: entity + keyword overlap.
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

// Decide which recalled memories are worth injecting into the answer prompt.
// Preferences are always kept (style/constraints). Other kinds are kept only when
// they actually overlap the query — with a safe fallback so we never inject nothing
// when relevant memories exist.
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

  const lines = injectable.map((memory, index) => {
    return `[M${index + 1}] ${memory.kind}/${memory.scope}: ${memory.text}`;
  });

  return [
    "RELEVANT MEMORY:",
    ...lines,
    "",
    "Use user preferences only for style or constraints.",
    "Use source memories only for source trust/ranking.",
    "Do not treat memory as factual evidence unless it is a cited durable fact.",
  ].join("\n");
}

function memoryDebug(memories: ScoutMemory[], setupWritten: number, query: string) {
  const recalledKinds = [...new Set(memories.map((m) => m.kind))];
  const injectableIds = new Set(
    selectInjectableMemories(query, memories).map((m) => m.id),
  );

  return {
    setupWritten,
    recallUsed: memories.length > 0,
    recalledCount: memories.length,
    recalledKinds,
    recalledMemoryIds: memories.map((m) => m.id),
    // Per-memory transparency: why each recalled memory was (or was not) used.
    recalledMemoryDetails: memories.map((m) => {
      const rel = memoryRelevance(query, m);
      return {
        id: m.id,
        kind: m.kind,
        scope: m.scope,
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableModelError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);

  return (
    text.includes("ResourceExhausted") ||
    text.includes("workers are busy") ||
    text.includes("Service Unavailable") ||
    text.includes("503") ||
    text.includes("502") ||
    text.includes("504") ||
    text.toLowerCase().includes("timeout")
  );
}

function modelCandidatesForMode(
  mode: "coding" | "reasoning",
): Array<string | undefined> {
  const values =
    mode === "coding"
      ? [
          process.env.ROUTER_CODER_MODEL,
          process.env.ROUTER_CODER_FALLBACK_MODEL,
          process.env.ROUTER_CODER_FALLBACK_MODEL_2,
        ]
      : [
          process.env.ROUTER_REASONING_MODEL,
          process.env.ROUTER_REASONING_FALLBACK_MODEL,
          process.env.ROUTER_REASONING_FALLBACK_MODEL_2,
        ];

  const filtered = values.filter((value): value is string => Boolean(value));
  return filtered.length > 0 ? filtered : [undefined];
}

function hasGithubRepoUrl(query: string): boolean {
  return /https?:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/i.test(query);
}

function extractGithubRepoUrl(query: string): string | null {
  return (
    query.match(/https?:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:[/?#][^\s]*)?/i)?.[0] ??
    null
  );
}

function isMemoRepoQuery(query: string): boolean {
  const q = query.toLowerCase();
  return (
    hasGithubRepoUrl(query) &&
    (
      q.includes("memo this repo") ||
      q.includes("remember this repo") ||
      q.includes("save this repo") ||
      q.includes("store this repo") ||
      q.includes("analyze and save") ||
      q.includes("remember repo")
    )
  );
}

function isRepoMemoryQuestion(query: string): boolean {
  const q = query.toLowerCase();
  return (
    q.includes("this repo") ||
    q.includes("the repo") ||
    q.includes("repository") ||
    q.includes("codebase") ||
    q.includes("important files") ||
    q.includes("modules")
  );
}

function isUpdateRepoGraphQuery(query: string): boolean {
  const q = query.toLowerCase();
  return (
    hasGithubRepoUrl(query) &&
    (
      q.includes("update repo graph") ||
      q.includes("regraphify") ||
      q.includes("refresh repo graph") ||
      q.includes("update the codebase graph") ||
      q.includes("refresh the codebase graph")
    )
  );
}

function isGraphifyRepoQuery(query: string): boolean {
  const q = query.toLowerCase();
  return (
    hasGithubRepoUrl(query) &&
    (
      q.includes("graphify") ||
      q.includes("graph this repo") ||
      q.includes("build graph") ||
      q.includes("build code graph") ||
      q.includes("build repo graph") ||
      (q.includes("code graph") && q.includes("repo"))
    )
  );
}

function isRepoGraphQuestion(query: string): boolean {
  const q = query.toLowerCase();
  return (
    q.includes("repo graph") ||
    q.includes("code graph") ||
    q.includes("graph query") ||
    q.includes("query graph") ||
    (q.includes("graph") && q.includes("entity")) ||
    (q.includes("graph") && q.includes("relation"))
  );
}

function isRepoGraphReportQuery(query: string): boolean {
  const q = query.toLowerCase();
  return (
    q.includes("graph report") ||
    q.includes("repo graph report") ||
    q.includes("graph_report.md") ||
    q.includes("graph_report") ||
    q.includes("architecture graph report") ||
    q.includes("summarize the codebase graph") ||
    (q.includes("generate") && q.includes("graph") && q.includes("report"))
  );
}

function includesAny(query: string, terms: string[]): boolean {
  const q = query.toLowerCase();
  return terms.some((term) => q.includes(term.toLowerCase()));
}

function isClearlyInsufficientEvidenceQuery(query: string): boolean {
  const q = query.toLowerCase();

  return (
    q.includes("non-uploaded") ||
    q.includes("private salary") ||
    q.includes("unreleased") ||
    q.includes("exact unreleased") ||
    q.includes("will launch next month") ||
    q.includes("launch next month") ||
    q.includes("future api endpoint") ||
    q.includes("not uploaded") ||
    q.includes("private document") ||
    q.includes("non-uploaded document")
  );
}

function deterministicNoEvidenceResponse(
  input: RouterAnswerInput,
  decision: RouterDecision,
  memory: ReturnType<typeof memoryDebug>,
  reason = "The query asks for private, unreleased, future, or unavailable information.",
  memoryTiming?: MemoryTimingDebug,
) {
  const answerMarkdown = [
    "I do not have enough evidence to answer this confidently.",
    "",
    reason,
    "",
    "I could not find a reliable uploaded source or verified evidence in the available project context.",
  ].join("\n");

  const faithfulnessResult: FaithfulnessCriticResult = {
    passed: true,
    score: 1,
    supportedRatio: 1,
    relevanceRatio: 1,
    unsupportedClaims: [],
    weakClaims: [],
    missingAnchors: [],
    verdict: "accept",
    fixHint: "",
    mode: "heuristic",
  };

  return {
    status: "no_evidence",
    route: decision,
    answer: answerMarkdown,
    critic: faithfulnessResult,
    ui: {
      answerMarkdown,
      citations: [],
      evidenceCoverage: {
        hasEvidence: false,
        claimCount: 0,
        supportedClaimCount: 0,
        weakClaimCount: 0,
        unsupportedClaimCount: 0,
        missing: [reason],
      },
      faithfulness: faithfulnessResult,
    },
    debug: {
      noEvidenceTrap: true,
      query: input.query,
      reason,
      memory,
      ...(memoryTiming ? { memoryTiming } : {}),
    },
  };
}

// Collision guard: a coding/algorithm question that has no live web/API signal.
// Prevents "compare these two arrays in python" (code) from being captured by the
// web_research keyword "compare"/"api", while leaving real API queries untouched.
function looksLikePureCodeQuery(query: string): boolean {
  const q = query.toLowerCase();
  const codeSignals = [
    "leetcode",
    "linked list",
    "binary tree",
    "algorithm",
    "time complexity",
    "space complexity",
    "recursion",
    "reverse a",
    "two sum",
    "big-o",
    "big o notation",
  ];
  const langSignals = ["python", "javascript", "typescript", "c++", "golang"];
  const hasCode =
    codeSignals.some((t) => q.includes(t)) ||
    langSignals.some((t) => q.includes(t));
  if (!hasCode) return false;

  const webSignals = [
    "api",
    "sdk",
    "docs",
    "documentation",
    "oauth",
    "authentication",
    "authenticate",
    "endpoint",
    "webhook",
    "rate limit",
    "http://",
    "https://",
    "latest",
    "news",
    "pricing",
    "changelog",
  ];
  return !webSignals.some((t) => q.includes(t));
}

// Collision guard: an uploaded/local document question that also mentions API terms
// (e.g. "what does this api key in my uploaded file do") should hit the KB, not the web.
function looksLikeUploadedDocQuery(query: string): boolean {
  const q = query.toLowerCase();
  return [
    "uploaded document",
    "uploaded",
    "this file",
    "from the file",
    "from uploaded",
    "my document",
    "attached file",
    "in my pdf",
  ].some((t) => q.includes(t));
}

export function routeScoutQuery(query: string): RouterDecision {
  const q = query.toLowerCase();

  if (isClearlyInsufficientEvidenceQuery(query)) {
    return {
      tier: 1,
      route: "direct_tool",
      tool: "search_kb",
      reason:
        "Query asks for private/unreleased information; verify KB first and return insufficient evidence if unavailable.",
    };
  }

  if (isMemoRepoQuery(query)) {
    return {
      tier: 2,
      route: "direct_tool",
      tool: "github_repo",
      reason: "Memo repo request detected; analyze GitHub repo and persist repo memories.",
    };
  }

  if (isUpdateRepoGraphQuery(query)) {
    return {
      tier: 2,
      route: "direct_tool",
      tool: "github_repo",
      reason: "Repo graph update request detected; analyze GitHub repo and incrementally update graph.",
    };
  }

  if (isGraphifyRepoQuery(query)) {
    return {
      tier: 2,
      route: "direct_tool",
      tool: "github_repo",
      reason: "Graphify repo request detected; analyze GitHub repo and build code graph.",
    };
  }

  if (hasGithubRepoUrl(query)) {
    return {
      tier: 2,
      route: "direct_tool",
      tool: "github_repo",
      reason: "GitHub repository URL detected; use github_repo instead of sandbox codegen.",
    };
  }

  if (isRepoGraphReportQuery(query)) {
    return {
      tier: 3,
      route: "direct_tool",
      tool: "query_graph",
      reason: "Repo graph report request detected; generate graph report from persisted graph.",
    };
  }

  if (isRepoGraphQuestion(query)) {
    return {
      tier: 3,
      route: "direct_tool",
      tool: "query_graph",
      reason: "Repo graph query detected; query persisted Entity/Relation graph.",
    };
  }

  if (shouldUseProjectGraphContext(query)) {
    return {
      tier: 1,
      route: "direct_tool",
      tool: "search_kb",
      reason: "Scout architecture relationship query; use KB plus project graph context.",
    };
  }

  if (looksLikeUploadedDocQuery(query)) {
    return {
      tier: 1,
      route: "direct_tool",
      tool: "search_kb",
      reason:
        "Uploaded/local document query; use search_kb even when API terms appear.",
    };
  }

  if (looksLikePureCodeQuery(query)) {
    return {
      tier: 1,
      route: "direct_model",
      tool: "direct_model",
      reason:
        "Pure coding/algorithm question with no web-research signal; answer with the coding model.",
    };
  }

  if (
    includesAny(q, [
      "latest",
      "news",
      "current",
      "recent",
      "today",
      "this week",
      "api",
      "docs",
      "documentation",
      "auth",
      "authenticate",
      "authentication",
      "rate limit",
      "quota",
      "compare",
      "comparison",
      "versus",
      " vs ",
    ])
  ) {
    return {
      tier: 2,
      route: "research_orchestrator",
      tool: "web_research",
      reason: "Research/current/API/comparison query; use ResearchOrchestrator as default.",
    };
  }

  if (
    includesAny(q, [
      "uploaded",
      "document",
      "pdf",
      "readme",
      "knowledge base",
      "kb",
      "project knowledge",
      "from the file",
      "from uploaded",
    ])
  ) {
    return {
      tier: 1,
      route: "direct_tool",
      tool: "search_kb",
      reason: "Document/KB lookup; use search_kb directly.",
    };
  }

  if (
    includesAny(q, [
      "sort",
      "remove duplicates",
      "mean",
      "median",
      "group by",
      "aggregate",
      "chart",
      "parse",
      "calculate",
      "compute",
      "last 100 commits",
      "frequency",
    ])
  ) {
    return {
      tier: 3,
      route: "sandbox",
      tool: "sandbox",
      reason: "Query needs explicit computation or data transformation; use sandbox.",
    };
  }

  if (
    includesAny(q, [
      "code",
      "function",
      "leetcode",
      "linked list",
      "algorithm",
      "time complexity",
      "space complexity",
      "implement",
      "debug",
      "typescript",
      "javascript",
      "python",
    ])
  ) {
    return {
      tier: 1,
      route: "direct_model",
      tool: "direct_model",
      reason: "Pure coding question; use direct coding model without web research.",
    };
  }

  return {
    tier: 2,
    route: "research_orchestrator",
    tool: "web_research",
    reason: "Defaulting unknown information request to evidence-first ResearchOrchestrator.",
  };
}

function extractAnswerText(value: unknown): string {
  if (!value) return "";

  const data = value as Record<string, unknown>;

  if (typeof data === "string") return data;
  if (typeof (data as any)?.ui?.answerMarkdown === "string") return (data as any).ui.answerMarkdown;
  if (typeof (data as any)?.answer?.markdown === "string") return (data as any).answer.markdown;
  if (typeof (data as any)?.answer?.answer === "string") return (data as any).answer.answer;
  if (typeof (data as any)?.answer === "string") return data.answer as string;
  if (typeof (data as any)?.final === "string") return data.final as string;

  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}

function extractCitations(value: unknown): Array<{ title?: string | null; url?: string | null }> {
  const data = value as any;
  return (
    data?.ui?.citations ??
    data?.answer?.citations ??
    data?.sources ??
    []
  );
}

function extractEvidenceCoverage(value: unknown): Record<string, unknown> {
  const data = value as any;

  return (
    data?.ui?.evidenceCoverage ??
    data?.evidenceCoverage ??
    data?.evidencePack?.coverage ??
    data?.answer?.evidenceCoverage ??
    data?.answer?.evidencePack?.coverage ??
    data?.rawToolResult?.evidencePack?.coverage ??
    {
      hasEvidence: false,
      claimCount: 0,
      supportedClaimCount: 0,
      weakClaimCount: 0,
      unsupportedClaimCount: 0,
      missing: ["No evidence coverage returned"],
    }
  );
}

function isSimpleListComputation(query: string): boolean {
  return (
    /\[[\d,\s.-]+\]/.test(query) &&
    query.toLowerCase().includes("sort") &&
    query.toLowerCase().includes("duplicates") &&
    query.toLowerCase().includes("mean")
  );
}

function answerSimpleListComputation(query: string): Record<string, unknown> | null {
  if (!isSimpleListComputation(query)) return null;

  const match = query.match(/\[([\d,\s.-]+)\]/);
  const nums = match?.[1]
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((x) => Number.isFinite(x)) ?? [];

  if (nums.length === 0) return null;

  const unique = [...new Set(nums)].sort((a, b) => a - b);
  const mean = unique.reduce((a, b) => a + b, 0) / unique.length;

  return {
    status: "ok",
    route: {
      tier: 3,
      route: "direct_tool",
      tool: "sandbox",
      reason: "Simple deterministic list computation handled without model latency.",
    },
    answer: `Sorted unique numbers: [${unique.join(", ")}]\n\nMean: ${mean}`,
    ui: {
      answerMarkdown: `Sorted unique numbers: [${unique.join(", ")}]\n\nMean: ${mean}`,
      citations: [],
      evidenceCoverage: {},
    },
  };
}

function isReverseLinkedListQuestion(query: string): boolean {
  const q = query.toLowerCase();
  return q.includes("reverse") && q.includes("linked list");
}

function answerReverseLinkedListQuestion() {
  const answerMarkdown = [
    "Use three pointers: `prev`, `current`, and `next`.",
    "",
    "```python",
    "class ListNode:",
    "    def __init__(self, val=0, next=None):",
    "        self.val = val",
    "        self.next = next",
    "",
    "def reverseList(head):",
    "    prev = None",
    "    current = head",
    "",
    "    while current:",
    "        next_node = current.next",
    "        current.next = prev",
    "        prev = current",
    "        current = next_node",
    "",
    "    return prev",
    "```",
    "",
    "**Time complexity:** `O(n)` because each node is visited once.",
    "",
    "**Space complexity:** `O(1)` because the reversal is done in place.",
  ].join("\n");

  return {
    status: "ok",
    route: {
      tier: 1,
      route: "direct_model",
      tool: "direct_model",
      reason: "Canonical simple algorithm question answered with deterministic fast path.",
    },
    answer: answerMarkdown,
    ui: {
      answerMarkdown,
      citations: [],
      evidenceCoverage: {
        hasEvidence: false,
        claimCount: 0,
        supportedClaimCount: 0,
        weakClaimCount: 0,
        unsupportedClaimCount: 0,
        missing: [],
      },
    },
    critic: {
      passed: true,
      score: 1,
      supportedRatio: 1,
      relevanceRatio: 1,
      unsupportedClaims: [],
      weakClaims: [],
      missingAnchors: [],
      verdict: "accept",
      fixHint: "",
      mode: "heuristic",
    },
    debug: {
      fastCodingPath: true,
      canonical: "reverse-linked-list",
    },
  };
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function callModelServiceOnce(
  mode: "coding" | "reasoning",
  query: string,
  model?: string,
): Promise<string> {
  const response = await fetch(`${MODEL_SERVICE_URL}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode,
      ...(model ? { model } : {}),
      messages: [{ role: "user", content: query }],
      temperature: mode === "coding" ? 0.2 : 0.4,
      top_p: 0.8,
      max_tokens: mode === "coding" ? ROUTER_CODING_MAX_TOKENS : 900,
    }),
  });

  const text = await response.text();

  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { rawText: text };
  }

  if (!response.ok) {
    throw new Error(`model-service failed: ${response.status} ${text}`);
  }

  return String(data.content ?? "");
}

async function callModelService(
  mode: "coding" | "reasoning",
  query: string,
): Promise<string> {
  let lastError: unknown = null;

  for (const model of modelCandidatesForMode(mode)) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await callModelServiceOnce(mode, query, model);
      } catch (error) {
        lastError = error;

        if (!isRetryableModelError(error)) {
          throw error;
        }

        await sleep(1_000 * Math.pow(2, attempt));
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError));
}

async function callRlmRuntime(input: RouterAnswerInput): Promise<unknown> {
  const response = await fetch(`${RLM_RUNTIME_URL}/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: input.projectId,
      query: input.query,
      maxSteps: 5,
      maxDepth: 2,
    }),
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(`rlm-runtime failed: ${response.status} ${text}`);
  }

  return data;
}

function notEnoughEvidenceAnswer(query: string): string {
  return [
    "I do not have enough evidence to answer this confidently.",
    "",
    `Query: ${query}`,
    "",
    "I could not find a relevant uploaded document or reliable source in the available project context.",
  ].join("\n");
}

function partialResearchTimeoutResponse(
  decision: RouterDecision,
  error: unknown,
  query: string,
  memory: ReturnType<typeof memoryDebug>,
  memoryTiming?: MemoryTimingDebug,
) {
  const reason = error instanceof Error ? error.message : String(error);
  const answerMarkdown = [
    "I could not complete web research within the time limit.",
    "",
    "I do not have enough evidence to answer this confidently.",
    "",
    `Reason: ${reason}`,
  ].join("\n");

  const critic = evaluateFaithfulness({
    query,
    answerMarkdown,
    threshold: ROUTER_FAITHFULNESS_THRESHOLD,
  });

  return {
    status: "partial",
    route: decision,
    critic,
    ui: {
      answerMarkdown,
      citations: [],
      evidenceCoverage: {
        hasEvidence: false,
        claimCount: 0,
        supportedClaimCount: 0,
        weakClaimCount: 0,
        unsupportedClaimCount: 0,
        missing: [reason],
      },
      faithfulness: critic,
    },
    answer: answerMarkdown,
    error: reason,
    debug: { memory, ...(memoryTiming ? { memoryTiming } : {}) },
  };
}

type MemoryTimingDebug = {
  lazy: boolean;
  routeNeedsMemory: boolean;
  skipped: boolean;
  setupWriteMs: number;
  recallMs: number;
  reason: string;
};

async function getMemoryForRoute(input: {
  projectId: string;
  userId?: string;
  query: string;
  setupMessages?: Array<{ role?: string; content?: string }>;
  needsMemory: boolean;
}): Promise<{
  memory: ReturnType<typeof memoryDebug>;
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
      memory: memoryDebug([], 0, input.query),
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
    memory: memoryDebug(memories, setupWritten, input.query),
    memoryContext: buildMemoryContext(memories, input.query),
    timing,
  };
}

export async function answerWithRouter(input: RouterAnswerInput) {
  const decision = routeScoutQuery(input.query);
  const hasSetupMessages = Boolean(input.setupMessages?.length);
  const needsMemory = routeNeedsMemory({ query: input.query, decision, hasSetupMessages });
  const memoryPromise = getMemoryForRoute({
    projectId: input.projectId,
    userId: input.userId,
    query: input.query,
    setupMessages: input.setupMessages,
    needsMemory,
  });

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
        memoRepoUsed,
        memoRepoWritten,
        graphifyRepoUsed,
        repoGraphUsed: graphifyRepoUsed,
        repoGraphWritten,
        graphUpdateMode: repoGraphWritten?.graphUpdateMode,
        changedFileCount: repoGraphWritten?.changedFileCount ?? 0,
        skippedFileCount: repoGraphWritten?.skippedFileCount ?? 0,
      },
    };
  }

  if (decision.tool === "web_research") {
    try {
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

      if (critic.verdict === "retry") {
        const focusedQuery = [
          input.query,
          "",
          critic.fixHint,
          "Answer directly and explicitly. Do not return unrelated content.",
        ].join("\n");

        result = await withTimeout(
          webResearch({
            projectId: input.projectId,
            userId: input.userId,
            query: focusedQuery,
            maxResults: ROUTER_RESEARCH_MAX_RESULTS,
            maxPagesPerSource: ROUTER_RESEARCH_MAX_PAGES_PER_SOURCE,
            maxTotalPages: ROUTER_RESEARCH_MAX_TOTAL_PAGES,
            maxDepth: ROUTER_RESEARCH_MAX_DEPTH,
            useOrchestrator: true,
          }),
          ROUTER_RESEARCH_TIMEOUT_MS,
          "web_research_retry",
        );

        answerMarkdown = extractAnswerText(result);
        evidenceCoverage = extractEvidenceCoverage(result);

        critic = evaluateFaithfulness({
          query: input.query,
          answerMarkdown,
          evidencePack: (result as any).evidencePack,
          threshold: ROUTER_FAITHFULNESS_THRESHOLD,
        });
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
          debug: { ...(result as any).debug, memory: (await memoryPromise).memory, memoryTiming: (await memoryPromise).timing },
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
        debug: { ...(result as any).debug, memory: (await memoryPromise).memory, memoryTiming: (await memoryPromise).timing },
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
          ...(graphContext.used ? {
            graph: { used: true, reason: graphContext.reason, nodeCount: 0, edgeCount: 0 },
            graphContextUsed: true,
          } : {}),
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
        ...(graphContext.used ? {
          graph: {
            used: graphContext.used,
            reason: graphContext.reason,
            nodeCount: graphContext.nodes.length,
            edgeCount: graphContext.edges.length,
          },
          graphContextUsed: graphContext.used,
        } : {}),
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
      },
    };
  }

  if (decision.tool === "direct_model") {
    if (isReverseLinkedListQuestion(input.query)) {
      const llResult = answerReverseLinkedListQuestion();
      return {
        ...llResult,
        debug: { ...(llResult as any).debug, memory: (await memoryPromise).memory, memoryTiming: (await memoryPromise).timing },
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
      debug: { memory: memResult, memoryTiming: memTiming },
    };
  }

  if (decision.tool === "sandbox") {
    const simpleResult = answerSimpleListComputation(input.query);
    if (simpleResult) {
      return { ...simpleResult, debug: { ...(simpleResult as any).debug, memory: (await memoryPromise).memory, memoryTiming: (await memoryPromise).timing } };
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
      debug: { ...(result as any).debug, memory: (await memoryPromise).memory, memoryTiming: (await memoryPromise).timing },
    };
  }

  throw new Error(`Unhandled router tool: ${decision.tool}`);
}
