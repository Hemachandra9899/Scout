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
  source: "deterministic" | "llm" | "fallback";
};

function normalizeQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ");
}

function hasGithubRepoUrl(query: string): boolean {
  return /https?:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/i.test(query);
}

function includesAny(query: string, terms: string[]): boolean {
  const q = query.toLowerCase();
  return terms.some((term) => q.includes(term.toLowerCase()));
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
  ];

  const webSignals = [
    "api",
    "sdk",
    "docs",
    "documentation",
    "oauth",
    "authentication",
    "endpoint",
    "webhook",
    "rate limit",
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
  const q = query.toLowerCase();

  if (q.includes("google ads") && q.includes("meta")) {
    return [
      "Google Ads API authentication, permissions, and rate limits",
      "Meta Marketing API authentication, permissions, and rate limits",
    ];
  }

  if (q.includes("compare") || q.includes(" vs ") || q.includes(" versus ")) {
    return normalizeQuery(query)
      .split(/\s+(?:vs|versus|and)\s+/i)
      .map((part) => part.trim())
      .filter(Boolean)
      .slice(0, 4);
  }

  return [normalizeQuery(query)];
}

function routeIntent(input: Omit<RouteIntent, "source" | "normalizedQuery" | "analysisAngles"> & {
  query: string;
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
    source: "deterministic",
  };
}

export function classifyRouteIntent(query: string): RouteIntent {
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
    return routeIntent({
      query,
      intent: "insufficient_evidence",
      tier: 1,
      route: "direct_tool",
      tool: "search_kb",
      confidence: 0.95,
      signals: ["private_or_unavailable_info"],
      reason: "Query asks for private/unreleased/unavailable information; verify KB first.",
    });
  }

  if (
    hasGithubRepoUrl(query) &&
    includesAny(q, ["memo this repo", "remember this repo", "save this repo", "store this repo", "remember repo"])
  ) {
    return routeIntent({
      query,
      intent: "memo_repo",
      tier: 2,
      route: "direct_tool",
      tool: "github_repo",
      confidence: 0.98,
      signals: ["github_url", "memo_repo"],
      reason: "Memo repo request detected.",
    });
  }

  if (
    hasGithubRepoUrl(query) &&
    includesAny(q, ["update repo graph", "regraphify", "refresh repo graph", "update the codebase graph"])
  ) {
    return routeIntent({
      query,
      intent: "update_repo_graph",
      tier: 2,
      route: "direct_tool",
      tool: "github_repo",
      confidence: 0.98,
      signals: ["github_url", "update_repo_graph"],
      reason: "Repo graph update request detected.",
    });
  }

  if (
    hasGithubRepoUrl(query) &&
    includesAny(q, ["graphify", "graph this repo", "build graph", "build code graph", "build repo graph", "code graph"])
  ) {
    return routeIntent({
      query,
      intent: "graphify_repo",
      tier: 2,
      route: "direct_tool",
      tool: "github_repo",
      confidence: 0.98,
      signals: ["github_url", "graphify"],
      reason: "Graphify repo request detected.",
    });
  }

  if (hasGithubRepoUrl(query)) {
    return routeIntent({
      query,
      intent: "github_repo",
      tier: 2,
      route: "direct_tool",
      tool: "github_repo",
      confidence: 0.98,
      signals: ["github_url"],
      reason: "GitHub repository URL detected.",
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
    ((q.includes("generate") || q.includes("genrate")) && q.includes("graph") && q.includes("report"))
  ) {
    return routeIntent({
      query,
      intent: "graph_report",
      tier: 3,
      route: "direct_tool",
      tool: "query_graph",
      confidence: 0.95,
      signals: ["graph_report"],
      reason: "Repo graph report request detected.",
    });
  }

  if (
    includesAny(q, ["repo graph", "code graph", "graph query", "query graph"]) ||
    (q.includes("graph") && (q.includes("entity") || q.includes("relation")))
  ) {
    return routeIntent({
      query,
      intent: "query_graph",
      tier: 3,
      route: "direct_tool",
      tool: "query_graph",
      confidence: 0.9,
      signals: ["repo_graph_query"],
      reason: "Repo graph query detected.",
    });
  }

  if (
    includesAny(q, ["which component", "how does", "connect", "calls", "called by", "flow"]) &&
    includesAny(q, ["scout", "rlm runtime", "worker", "tools", "final answer"])
  ) {
    return routeIntent({
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

  if (looksLikeUploadedDocQuery(query)) {
    return routeIntent({
      query,
      intent: "kb",
      tier: 1,
      route: "direct_tool",
      tool: "search_kb",
      confidence: 0.9,
      signals: ["uploaded_document"],
      reason: "Uploaded/local document query should use KB.",
    });
  }

  if (looksLikePureCodeQuery(query)) {
    return routeIntent({
      query,
      intent: "code",
      tier: 1,
      route: "direct_model",
      tool: "direct_model",
      confidence: 0.88,
      signals: ["pure_code"],
      reason: "Pure coding/algorithm query should use direct model.",
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
      "parse",
      "calculate",
      "compute",
      "last 100 commits",
      "frequency",
    ])
  ) {
    return routeIntent({
      query,
      intent: "sandbox",
      tier: 3,
      route: "sandbox",
      tool: "sandbox",
      confidence: 0.85,
      signals: ["computation"],
      reason: "Query needs explicit computation/data transformation.",
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
    return routeIntent({
      query,
      intent: "web_research",
      tier: 2,
      route: "research_orchestrator",
      tool: "web_research",
      confidence: 0.82,
      signals: ["fresh_or_external_research"],
      reason: "Research/current/API/comparison query.",
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
    return routeIntent({
      query,
      intent: "kb",
      tier: 1,
      route: "direct_tool",
      tool: "search_kb",
      confidence: 0.82,
      signals: ["kb_document"],
      reason: "Document/KB lookup.",
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
    return routeIntent({
      query,
      intent: "code",
      tier: 1,
      route: "direct_model",
      tool: "direct_model",
      confidence: 0.78,
      signals: ["code"],
      reason: "Coding query.",
    });
  }

  return routeIntent({
    query,
    intent: "web_research",
    tier: 2,
    route: "research_orchestrator",
    tool: "web_research",
    confidence: 0.6,
    signals: ["default_research"],
    reason: "Default evidence-first research route.",
  });
}

const ROUTER_LLM_INTENT_ENABLED =
  process.env.ROUTER_LLM_INTENT_ENABLED === "true";

export async function classifyRouteIntentWithOptionalLlm(
  query: string,
): Promise<RouteIntent> {
  const deterministic = classifyRouteIntent(query);

  if (!ROUTER_LLM_INTENT_ENABLED) {
    return deterministic;
  }

  // M3.2 will implement LLM classification for low-confidence queries.
  return deterministic;
}
