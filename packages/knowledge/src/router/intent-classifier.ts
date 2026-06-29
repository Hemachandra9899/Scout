export type RouteTool =
  | "search_kb"
  | "web_research"
  | "github_repo"
  | "query_graph"
  | "sandbox"
  | "direct_model";

export type RouteName =
  | "direct_tool"
  | "research_orchestrator"
  | "sandbox"
  | "direct_model";

export type RouteIntentName =
  | "kb"
  | "web_research"
  | "github_repo"
  | "memo_repo"
  | "graphify_repo"
  | "update_repo_graph"
  | "query_graph"
  | "graph_report"
  | "sandbox"
  | "code"
  | "insufficient_evidence";

export type RouteIntentSource = "deterministic" | "llm" | "fallback";

export type RouteIntent = {
  intent: RouteIntentName;
  tier: 1 | 2 | 3;
  route: RouteName;
  tool: RouteTool;
  confidence: number;
  normalizedQuery: string;
  signals: string[];
  analysisAngles: string[];
  reason: string;
  source: RouteIntentSource;
};

function normalizeQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ");
}

function includesAny(query: string, terms: string[]): boolean {
  const q = query.toLowerCase();
  return terms.some((term) => q.includes(term.toLowerCase()));
}

function hasGithubRepoUrl(query: string): boolean {
  return /https?:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/i.test(query);
}

function looksLikeUploadedDocQuery(query: string): boolean {
  return includesAny(query, [
    "uploaded document",
    "uploaded",
    "this file",
    "from the file",
    "from uploaded",
    "my document",
    "attached file",
    "in my pdf",
    "in my uploaded file",
  ]);
}

function looksLikePureCodeQuery(query: string): boolean {
  const q = query.toLowerCase();

  const codeSignals = [
    "python",
    "javascript",
    "typescript",
    "c++",
    "golang",
    "leetcode",
    "linked list",
    "binary tree",
    "algorithm",
    "time complexity",
    "space complexity",
    "array",
    "arrays",
    "two sum",
    "recursion",
    "reverse a",
    "function",
    "implement",
  ];

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
    "quota",
    "latest",
    "news",
    "pricing",
    "changelog",
    "http://",
    "https://",
  ];

  const hasCode = codeSignals.some((term) => q.includes(term));
  if (!hasCode) return false;

  return !webSignals.some((term) => q.includes(term));
}

function splitAnalysisAngles(query: string): string[] {
  const normalized = normalizeQuery(query);
  const q = normalized.toLowerCase();

  if (q.includes("google ads") && q.includes("meta")) {
    return [
      "Google Ads API authentication, permissions, rate limits, and docs",
      "Meta Marketing API authentication, permissions, rate limits, and docs",
    ];
  }

  if (q.includes("compare") || q.includes(" versus ") || q.includes(" vs ")) {
    return normalized
      .split(/\s+(?:vs|versus|and)\s+/i)
      .map((part) => part.trim())
      .filter(Boolean)
      .slice(0, 4);
  }

  return [normalized];
}

function makeIntent(input: {
  query: string;
  intent: RouteIntentName;
  tier: 1 | 2 | 3;
  route: RouteName;
  tool: RouteTool;
  confidence: number;
  signals: string[];
  reason: string;
  source?: RouteIntentSource;
}): RouteIntent {
  return {
    intent: input.intent,
    tier: input.tier,
    route: input.route,
    tool: input.tool,
    confidence: input.confidence,
    normalizedQuery: normalizeQuery(input.query),
    signals: input.signals,
    analysisAngles: splitAnalysisAngles(input.query),
    reason: input.reason,
    source: input.source ?? "deterministic",
  };
}

export function classifyRouteIntentDeterministic(query: string): RouteIntent {
  const q = query.toLowerCase();

  if (
    includesAny(q, [
      "non-uploaded",
      "private salary",
      "unreleased",
      "exact unreleased",
      "will launch next month",
      "launch next month",
      "future api endpoint",
      "not uploaded",
      "private document",
      "non-uploaded document",
    ])
  ) {
    return makeIntent({
      query,
      intent: "insufficient_evidence",
      tier: 1,
      route: "direct_tool",
      tool: "search_kb",
      confidence: 0.95,
      signals: ["private_or_unavailable_info"],
      reason:
        "Query asks for private, unreleased, future, or unavailable information; verify KB first.",
    });
  }

  if (
    hasGithubRepoUrl(query) &&
    includesAny(q, [
      "memo this repo",
      "remember this repo",
      "save this repo",
      "store this repo",
      "analyze and save",
      "remember repo",
    ])
  ) {
    return makeIntent({
      query,
      intent: "memo_repo",
      tier: 2,
      route: "direct_tool",
      tool: "github_repo",
      confidence: 0.98,
      signals: ["github_url", "memo_repo"],
      reason: "Memo repo request detected; analyze GitHub repo and persist repo memories.",
    });
  }

  if (
    hasGithubRepoUrl(query) &&
    includesAny(q, [
      "update repo graph",
      "regraphify",
      "refresh repo graph",
      "update the codebase graph",
      "refresh the codebase graph",
    ])
  ) {
    return makeIntent({
      query,
      intent: "update_repo_graph",
      tier: 2,
      route: "direct_tool",
      tool: "github_repo",
      confidence: 0.98,
      signals: ["github_url", "update_repo_graph"],
      reason: "Repo graph update request detected; analyze GitHub repo and incrementally update graph.",
    });
  }

  if (
    hasGithubRepoUrl(query) &&
    includesAny(q, [
      "graphify",
      "graph this repo",
      "build graph",
      "build code graph",
      "build repo graph",
      "code graph",
    ])
  ) {
    return makeIntent({
      query,
      intent: "graphify_repo",
      tier: 2,
      route: "direct_tool",
      tool: "github_repo",
      confidence: 0.98,
      signals: ["github_url", "graphify_repo"],
      reason: "Graphify repo request detected; analyze GitHub repo and build code graph.",
    });
  }

  if (hasGithubRepoUrl(query)) {
    return makeIntent({
      query,
      intent: "github_repo",
      tier: 2,
      route: "direct_tool",
      tool: "github_repo",
      confidence: 0.98,
      signals: ["github_url"],
      reason: "GitHub repository URL detected; use github_repo.",
    });
  }

  if (
    includesAny(q, [
      "graph report",
      "repo graph report",
      "graph_report.md",
      "graph_report",
      "architecture graph report",
      "summarize the codebase graph",
    ]) ||
    ((q.includes("generate") || q.includes("genrate")) &&
      q.includes("graph") &&
      q.includes("report"))
  ) {
    return makeIntent({
      query,
      intent: "graph_report",
      tier: 3,
      route: "direct_tool",
      tool: "query_graph",
      confidence: 0.95,
      signals: ["graph_report"],
      reason: "Repo graph report request detected; generate graph report from persisted graph.",
    });
  }

  if (
    includesAny(q, ["repo graph", "code graph", "graph query", "query graph"]) ||
    (q.includes("graph") && q.includes("entity")) ||
    (q.includes("graph") && q.includes("relation"))
  ) {
    return makeIntent({
      query,
      intent: "query_graph",
      tier: 3,
      route: "direct_tool",
      tool: "query_graph",
      confidence: 0.9,
      signals: ["repo_graph_query"],
      reason: "Repo graph query detected; query persisted Entity/Relation graph.",
    });
  }

  if (looksLikeUploadedDocQuery(query)) {
    return makeIntent({
      query,
      intent: "kb",
      tier: 1,
      route: "direct_tool",
      tool: "search_kb",
      confidence: 0.9,
      signals: ["uploaded_document"],
      reason: "Uploaded/local document query; use search_kb even when API terms appear.",
    });
  }

  if (looksLikePureCodeQuery(query)) {
    return makeIntent({
      query,
      intent: "code",
      tier: 1,
      route: "direct_model",
      tool: "direct_model",
      confidence: 0.88,
      signals: ["pure_code"],
      reason: "Pure coding/algorithm question with no web-research signal.",
    });
  }

  // Scout architecture relationship query — project graph context
  if (
    includesAny(q, ["which component", "how does", "connect", "calls", "called by", "flow"]) &&
    includesAny(q, ["scout", "rlm runtime", "worker", "tools", "final answer"])
  ) {
    return makeIntent({
      query,
      intent: "kb",
      tier: 1,
      route: "direct_tool",
      tool: "search_kb",
      confidence: 0.9,
      signals: ["project_graph_context"],
      reason: "Scout architecture relationship query; use KB plus project graph context.",
    });
  }

  // Memo'd repo follow-up: "from remembered repo context" should route to search_kb
  if (
    includesAny(q, ["remembered repo", "repo context", "from the repo", "memo'd", "memorized"])
  ) {
    return makeIntent({
      query,
      intent: "kb",
      tier: 1,
      route: "direct_tool",
      tool: "search_kb",
      confidence: 0.85,
      signals: ["memo_repo_followup"],
      reason: "Memory follow-up query referencing remembered repo context; use search_kb.",
    });
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
    return makeIntent({
      query,
      intent: "sandbox",
      tier: 3,
      route: "sandbox",
      tool: "sandbox",
      confidence: 0.85,
      signals: ["computation"],
      reason: "Query needs explicit computation or data transformation; use sandbox.",
    });
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
    return makeIntent({
      query,
      intent: "web_research",
      tier: 2,
      route: "research_orchestrator",
      tool: "web_research",
      confidence: 0.82,
      signals: ["fresh_or_external_research"],
      reason: "Research/current/API/comparison query; use ResearchOrchestrator.",
    });
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
    return makeIntent({
      query,
      intent: "kb",
      tier: 1,
      route: "direct_tool",
      tool: "search_kb",
      confidence: 0.82,
      signals: ["kb_document"],
      reason: "Document/KB lookup; use search_kb directly.",
    });
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
    return makeIntent({
      query,
      intent: "code",
      tier: 1,
      route: "direct_model",
      tool: "direct_model",
      confidence: 0.78,
      signals: ["code"],
      reason: "Pure coding question; use direct coding model without web research.",
    });
  }

  return makeIntent({
    query,
    intent: "web_research",
    tier: 2,
    route: "research_orchestrator",
    tool: "web_research",
    confidence: 0.6,
    signals: ["default_research"],
    reason: "Defaulting unknown information request to evidence-first ResearchOrchestrator.",
  });
}

export function classifyRouteIntent(query: string): RouteIntent {
  return classifyRouteIntentDeterministic(query);
}

export function routeIntentToDecision(intent: RouteIntent) {
  return {
    tier: intent.tier,
    route: intent.route,
    tool: intent.tool,
    reason: intent.reason,
  };
}

export type LlmIntentClassifier = (input: {
  query: string;
  deterministic: RouteIntent;
  prompt: string;
  timeoutMs: number;
}) => Promise<string>;

const VALID_INTENTS = new Set<RouteIntentName>([
  "kb",
  "web_research",
  "github_repo",
  "memo_repo",
  "graphify_repo",
  "update_repo_graph",
  "query_graph",
  "graph_report",
  "sandbox",
  "code",
  "insufficient_evidence",
]);

const INTENT_TO_ROUTE: Record<RouteIntentName, Pick<RouteIntent, "tier" | "route" | "tool">> = {
  kb: { tier: 1, route: "direct_tool", tool: "search_kb" },
  web_research: { tier: 2, route: "research_orchestrator", tool: "web_research" },
  github_repo: { tier: 2, route: "direct_tool", tool: "github_repo" },
  memo_repo: { tier: 2, route: "direct_tool", tool: "github_repo" },
  graphify_repo: { tier: 2, route: "direct_tool", tool: "github_repo" },
  update_repo_graph: { tier: 2, route: "direct_tool", tool: "github_repo" },
  query_graph: { tier: 3, route: "direct_tool", tool: "query_graph" },
  graph_report: { tier: 3, route: "direct_tool", tool: "query_graph" },
  sandbox: { tier: 3, route: "sandbox", tool: "sandbox" },
  code: { tier: 1, route: "direct_model", tool: "direct_model" },
  insufficient_evidence: { tier: 1, route: "direct_tool", tool: "search_kb" },
};

function parseLlmIntentJson(input: string): Partial<RouteIntent> | null {
  try {
    const parsed = JSON.parse(input) as Record<string, unknown>;
    const intent = parsed.intent;

    if (typeof intent !== "string" || !VALID_INTENTS.has(intent as RouteIntentName)) {
      return null;
    }

    const confidence =
      typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence)
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0.7;

    const reason =
      typeof parsed.reason === "string"
        ? parsed.reason.slice(0, 240)
        : "LLM classifier selected route.";

    const normalizedQuery =
      typeof parsed.normalizedQuery === "string"
        ? parsed.normalizedQuery.slice(0, 500)
        : "";

    const signals = Array.isArray(parsed.signals)
      ? parsed.signals.map((x) => String(x)).slice(0, 8)
      : ["llm_classifier"];

    const analysisAngles = Array.isArray(parsed.analysisAngles)
      ? parsed.analysisAngles.map((x) => String(x)).filter(Boolean).slice(0, 4)
      : [];

    const route = INTENT_TO_ROUTE[intent as RouteIntentName];

    return {
      intent: intent as RouteIntentName,
      tier: route.tier,
      route: route.route,
      tool: route.tool,
      confidence,
      reason,
      normalizedQuery,
      signals,
      analysisAngles,
      source: "llm" as const,
    };
  } catch {
    return null;
  }
}

function buildLlmIntentPrompt(query: string, deterministic: RouteIntent): string {
  return [
    "You are Scout's routing intent classifier.",
    "You do not answer the user.",
    "Return ONLY valid JSON.",
    "",
    "Allowed intents:",
    "kb, web_research, github_repo, memo_repo, graphify_repo, update_repo_graph, query_graph, graph_report, sandbox, code, insufficient_evidence",
    "",
    "Rules:",
    "- Use the cheapest tool that can answer correctly.",
    "- Uploaded/local files use kb.",
    "- GitHub repo URLs use github_repo unless graph/report wording routes to graph flows.",
    "- Pure coding questions use code/direct_model.",
    "- Explicit computation/data transforms use sandbox.",
    "- Fresh/current/API/docs/comparison questions use web_research.",
    "- Private/unavailable/future/non-uploaded info uses insufficient_evidence.",
    "- Do not overroute to web just because the word api appears.",
    "",
    "Return JSON shape:",
    JSON.stringify(
      {
        intent: "web_research",
        confidence: 0.0,
        normalizedQuery: "normalized query",
        signals: ["short_signal"],
        analysisAngles: ["angle 1"],
        reason: "one sentence",
      },
      null,
      2,
    ),
    "",
    `User query: ${query}`,
    "",
    `Deterministic fallback: ${JSON.stringify({
      intent: deterministic.intent,
      confidence: deterministic.confidence,
      reason: deterministic.reason,
      signals: deterministic.signals,
    })}`,
  ].join("\n");
}

export async function classifyRouteIntentWithOptionalLlm(input: {
  query: string;
  llm?: LlmIntentClassifier;
}): Promise<RouteIntent> {
  const deterministic = classifyRouteIntentDeterministic(input.query);

  if (process.env.ROUTER_LLM_INTENT_ENABLED !== "true") {
    return deterministic;
  }

  const threshold = Number(process.env.ROUTER_LLM_INTENT_THRESHOLD ?? 0.75);
  if (deterministic.confidence >= threshold) {
    return deterministic;
  }

  if (!input.llm) {
    return {
      ...deterministic,
      source: "fallback",
      signals: [...deterministic.signals, "llm_unavailable"],
    };
  }

  const timeoutMs = Number(process.env.ROUTER_LLM_INTENT_TIMEOUT_MS ?? 4000);
  const prompt = buildLlmIntentPrompt(input.query, deterministic);

  try {
    const output = await Promise.race([
      input.llm({
        query: input.query,
        deterministic,
        prompt,
        timeoutMs,
      }),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error("LLM intent classifier timed out")), timeoutMs),
      ),
    ]);

    const parsed = parseLlmIntentJson(output);
    if (!parsed) {
      return {
        ...deterministic,
        source: "fallback",
        signals: [...deterministic.signals, "llm_bad_json"],
      };
    }

    return {
      ...deterministic,
      ...parsed,
      normalizedQuery: parsed.normalizedQuery || deterministic.normalizedQuery,
      analysisAngles:
        parsed.analysisAngles && parsed.analysisAngles.length > 0
          ? parsed.analysisAngles
          : deterministic.analysisAngles,
      signals: [...new Set([...(deterministic.signals ?? []), ...(parsed.signals ?? [])])],
      source: "llm",
    } as RouteIntent;
  } catch {
    return {
      ...deterministic,
      source: "fallback",
      signals: [...deterministic.signals, "llm_error"],
    };
  }
}
