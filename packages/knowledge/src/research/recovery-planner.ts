import {
  buildFocusedResearchQueries,
  extractQueryAnchors,
  missingRequiredSynthesisGroups,
} from "./query-anchors.js";

export type EvidenceRecoveryPlan = {
  shouldRecover: boolean;
  reason: string;
  queries: string[];
  missing: string[];
};

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function safeNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function buildEvidenceRecoveryPlan(input: {
  query: string;
  answerMarkdown?: string;
  coverage?: Record<string, unknown>;
  sourceRelevance?: {
    missingRequiredGroups?: string[];
  } | null;
}): EvidenceRecoveryPlan {
  const coverage = input.coverage ?? {};

  const supported = safeNumber(coverage.supportedClaimCount);
  const weak = safeNumber(coverage.weakClaimCount);
  const claimCount =
    safeNumber(coverage.claimCount) ||
    safeNumber(coverage.filteredClaimCount) ||
    supported + weak + safeNumber(coverage.unsupportedClaimCount);

  const hasEvidence = Boolean(coverage.hasEvidence) || claimCount > 0;
  const missingFromCoverage = Array.isArray(coverage.missing)
    ? coverage.missing.map(String)
    : [];

  const missingFromSourceRelevance =
    input.sourceRelevance?.missingRequiredGroups?.map(String) ?? [];

  const missingFromAnswer = input.answerMarkdown
    ? missingRequiredSynthesisGroups(input.answerMarkdown, input.query)
    : [];

  const missing = unique([
    ...missingFromCoverage,
    ...missingFromSourceRelevance,
    ...missingFromAnswer,
  ]);

  const lowEvidence = !hasEvidence || claimCount === 0;
  const lowSupport = claimCount > 0 && supported === 0 && weak === 0;
  const missingRequired = missing.length > 0;

  if (!lowEvidence && !lowSupport && !missingRequired) {
    return {
      shouldRecover: false,
      reason: "Evidence is sufficient.",
      queries: [],
      missing: [],
    };
  }

  const anchors = extractQueryAnchors(input.query);
  const focused = buildFocusedResearchQueries(input.query);

  const missingQueries = missing.flatMap((item) => [
    `${input.query} ${item} official documentation`,
    `${item} ${input.query} official source`,
  ]);

  const anchorQueries = anchors.flatMap((anchor) => [
    `${input.query} ${anchor} official documentation`,
    `${anchor} ${input.query}`,
  ]);

  const queries = unique([
    ...missingQueries,
    ...anchorQueries,
    ...focused,
    input.query,
  ]).slice(0, 4);

  return {
    shouldRecover: true,
    reason: lowEvidence
      ? "No usable evidence."
      : lowSupport
        ? "Evidence had no supported or weak claims."
        : "Missing required evidence anchors.",
    queries,
    missing,
  };
}
