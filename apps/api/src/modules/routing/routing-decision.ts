import {
  classifyRouteIntent,
  routeIntentToDecision,
} from "@rlm-forge/knowledge/router/intent-classifier.js";

export type RouterTier = 1 | 2 | 3;

export type RouterDecision = {
  tier: RouterTier;
  route: "direct_tool" | "research_orchestrator" | "sandbox" | "direct_model";
  tool: "search_kb" | "github_repo" | "web_research" | "sandbox" | "direct_model" | "query_graph";
  reason: string;
};

export function hasGithubRepoUrl(query: string): boolean {
  return /https?:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/i.test(query);
}

export function extractGithubRepoUrl(query: string): string | null {
  return (
    query.match(/https?:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:[/?#][^\s]*)?/i)?.[0] ??
    null
  );
}

export function isMemoRepoQuery(query: string): boolean {
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

export function isRepoMemoryQuestion(query: string): boolean {
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

export function isUpdateRepoGraphQuery(query: string): boolean {
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

export function isGraphifyRepoQuery(query: string): boolean {
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

export function isRepoGraphQuestion(query: string): boolean {
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

export function isRepoGraphReportQuery(query: string): boolean {
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

export function includesAny(query: string, terms: string[]): boolean {
  const q = query.toLowerCase();
  return terms.some((term) => q.includes(term.toLowerCase()));
}

export function isClearlyInsufficientEvidenceQuery(query: string): boolean {
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

export function looksLikePureCodeQuery(query: string): boolean {
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

export function looksLikeUploadedDocQuery(query: string): boolean {
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
  return routeIntentToDecision(classifyRouteIntent(query));
}

export function routeDebug(query: string) {
  const intent = classifyRouteIntent(query);

  return {
    tool: intent.tool,
    tier: intent.tier,
    intent: intent.intent,
    confidence: intent.confidence,
    normalizedQuery: intent.normalizedQuery,
    signals: intent.signals,
    analysisAngles: intent.analysisAngles,
    reason: intent.reason,
    source: intent.source,
  };
}

export function isSimpleListComputation(query: string): boolean {
  return (
    /\[[\d,\s.-]+\]/.test(query) &&
    query.toLowerCase().includes("sort") &&
    query.toLowerCase().includes("duplicates") &&
    query.toLowerCase().includes("mean")
  );
}

export function isReverseLinkedListQuestion(query: string): boolean {
  const q = query.toLowerCase();
  return q.includes("reverse") && q.includes("linked list");
}
