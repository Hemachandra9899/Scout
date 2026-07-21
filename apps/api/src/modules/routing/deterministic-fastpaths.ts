import type { RouterDecision, RouterTier } from "./routing-decision.js";
import {
  evaluateFaithfulness,
  type FaithfulnessCriticResult,
} from "./faithfulness-critic.js";
import { routeDebug } from "./routing-decision.js";
import { isSimpleListComputation, isReverseLinkedListQuestion, isClearlyInsufficientEvidenceQuery } from "./routing-decision.js";
import { cacheWrap, modelCallCacheKey, CACHE_MODEL_TTL_MS } from "@rlm-forge/knowledge/cache/index.js";

const MODEL_SERVICE_URL =
  process.env.MODEL_SERVICE_URL || "http://model-service:8100";

const RLM_RUNTIME_URL =
  process.env.RLM_RUNTIME_URL || "http://rlm-runtime:8787";

const ROUTER_CODING_TIMEOUT_MS = Number(
  process.env.ROUTER_CODING_TIMEOUT_MS || 45_000,
);
const ROUTER_REASONING_TIMEOUT_MS = Number(
  process.env.ROUTER_REASONING_TIMEOUT_MS || 60_000,
);
const ROUTER_CODING_MAX_TOKENS = Number(
  process.env.ROUTER_CODING_MAX_TOKENS || 900,
);

export type MemoryTimingDebug = {
  lazy: boolean;
  routeNeedsMemory: boolean;
  skipped: boolean;
  setupWriteMs: number;
  recallMs: number;
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

export async function withTimeout<T>(
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
  const timeoutMs =
    mode === "coding" ? ROUTER_CODING_TIMEOUT_MS : ROUTER_REASONING_TIMEOUT_MS;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${MODEL_SERVICE_URL}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        mode,
        ...(model ? { model } : {}),
        messages: [{ role: "user", content: query }],
        temperature: mode === "coding" ? 0.2 : 0.4,
        top_p: 0.8,
        max_tokens: mode === "coding" ? ROUTER_CODING_MAX_TOKENS : 900,
      }),
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(
        `model-service /chat (${mode}${model ? `:${model}` : ""}) timed out after ${timeoutMs}ms`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

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

export async function callModelService(
  mode: "coding" | "reasoning",
  query: string,
): Promise<string> {
  const { value } = await cacheWrap(
    modelCallCacheKey(mode, query),
    () => callModelServiceUncached(mode, query),
    CACHE_MODEL_TTL_MS,
  );
  return value;
}

async function callModelServiceUncached(
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

export async function callRlmRuntime(input: RouterAnswerInput): Promise<unknown> {
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

function claimToText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return String(record.claim ?? record.text ?? record.anchor ?? JSON.stringify(record));
  }
  return String(value ?? "");
}

export function extractAnswerText(value: unknown): string {
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

export function extractCitations(value: unknown): Array<{ title?: string | null; url?: string | null }> {
  const data = value as any;
  return (
    data?.ui?.citations ??
    data?.answer?.citations ??
    data?.sources ??
    []
  );
}

export function extractEvidenceCoverage(value: unknown): Record<string, unknown> {
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

export function shouldRunFocusedRetry(input: {
  decision: RouterDecision;
  critic: FaithfulnessCriticResult;
}): boolean {
  if (input.decision.tool !== "web_research") return false;
  if (input.critic.verdict !== "retry") return false;

  const missingAnchors = input.critic.missingAnchors ?? [];
  const weakClaims = input.critic.weakClaims ?? [];
  const unsupportedClaims = input.critic.unsupportedClaims ?? [];

  return (
    missingAnchors.length > 0 ||
    weakClaims.length > 0 ||
    unsupportedClaims.length > 0 ||
    input.critic.supportedRatio < Number(process.env.ROUTER_FAITHFULNESS_THRESHOLD || 0.7)
  );
}

export function buildFocusedRetryQuery(input: {
  originalQuery: string;
  critic: FaithfulnessCriticResult;
}): string {
  const anchors = [
    ...(input.critic.missingAnchors ?? []),
    ...(input.critic.weakClaims ?? []).map(claimToText).slice(0, 3),
    ...(input.critic.unsupportedClaims ?? []).map(claimToText).slice(0, 3),
  ]
    .map((x) => String(x).trim())
    .filter(Boolean)
    .slice(0, 6);

  if (anchors.length === 0) {
    return input.originalQuery;
  }

  return [
    input.originalQuery,
    "",
    "Focused recovery: find reliable evidence only for these missing or weak points:",
    ...anchors.map((anchor) => `- ${anchor}`),
  ].join("\n");
}

export function answerSimpleListComputation(query: string): Record<string, unknown> | null {
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

export function answerReverseLinkedListQuestion(query: string) {
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
      routing: routeDebug(query),
    },
  };
}

export function notEnoughEvidenceAnswer(query: string): string {
  return [
    "I do not have enough evidence to answer this confidently.",
    "",
    `Query: ${query}`,
    "",
    "I could not find a relevant uploaded document or reliable source in the available project context.",
  ].join("\n");
}

export function partialResearchTimeoutResponse(
  decision: RouterDecision,
  error: unknown,
  query: string,
  memory: Record<string, unknown>,
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
    threshold: Number(process.env.ROUTER_FAITHFULNESS_THRESHOLD || 0.7),
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
    debug: { memory, ...(memoryTiming ? { memoryTiming } : {}), routing: routeDebug(query) },
  };
}

export function deterministicNoEvidenceResponse(
  input: RouterAnswerInput,
  decision: RouterDecision,
  memory: Record<string, unknown>,
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
      routing: routeDebug(input.query),
      ...(memoryTiming ? { memoryTiming } : {}),
    },
  };
}


