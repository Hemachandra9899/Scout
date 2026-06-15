function extractResearchTrace(response) {
  return (
    response?.researchTrace ??
    response?.debug?.researchTrace ??
    response?.debug?.researchTrace?.stages ??
    response?.rawToolResult?.debug?.researchTrace ??
    response?.ui?.debug?.researchTrace ??
    []
  );
}

export function buildTrajectory({ caseItem, response, row }) {
  const route = response?.route ?? {};
  const ui = response?.ui ?? {};
  const critic = ui?.faithfulness ?? {};
  const evidenceCoverage = ui?.evidenceCoverage ?? {};

  return {
    caseId: caseItem.id,
    query: caseItem.query,
    expected: {
      tier: caseItem.expectedTier,
      tool: caseItem.expectedTool,
      mustMention: caseItem.mustMention ?? [],
      mustMentionAnyGroups: caseItem.mustMentionAnyGroups ?? [],
      mustNotClaim: caseItem.mustNotClaim ?? [],
    },
    trajectory: [
      {
        type: "route_decision",
        tier: route.tier,
        tool: route.tool,
        reason: route.reason,
      },
      {
        type: "tool_result",
        tool: route.tool,
        status: response?.status ?? "unknown",
        citations: ui?.citations ?? [],
        evidenceCoverage,
        researchTrace: extractResearchTrace(response),
        sourceRelevance:
          response?.debug?.sourceRelevance ??
          response?.rawToolResult?.debug?.sourceRelevance ??
          null,
      },
      {
        type: "critic_verdict",
        verdict: critic?.verdict,
        score: critic?.score,
        supportedRatio: critic?.supportedRatio,
        relevanceRatio: critic?.relevanceRatio,
        missingAnchors: critic?.missingAnchors ?? [],
        unsupportedClaims: critic?.unsupportedClaims ?? [],
      },
      {
        type: "final_answer",
        answerPreview: row.answerPreview,
      },
    ],
    metrics: {
      passed: row.passed,
      routingPassed: row.routingPassed,
      groundedRatio: row.groundedRatio,
      correctness: row.correctness,
      completeness: row.completeness,
      latencyMs: row.durationMs,
      failures: row.failures,
    },
  };
}
