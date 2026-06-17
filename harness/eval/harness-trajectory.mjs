function extractPhase2Signals(response) {
  const debug = response?.debug ?? {};
  const ui = response?.ui ?? {};
  const raw = response?.rawToolResult ?? {};

  return {
    recallUsed:
      debug.recallUsed ??
      debug.memory?.recallUsed ??
      ui.memory?.recallUsed ??
      raw.debug?.memory?.recallUsed ??
      false,

    sourceReuseUsed:
      debug.sourceReuseUsed ??
      debug.memory?.sourceReuseUsed ??
      ui.memory?.sourceReuseUsed ??
      raw.debug?.memory?.sourceReuseUsed ??
      false,

    blockedSourceAvoided:
      debug.blockedSourceAvoided ??
      debug.memory?.blockedSourceAvoided ??
      ui.memory?.blockedSourceAvoided ??
      raw.debug?.memory?.blockedSourceAvoided ??
      false,

    recoveryAttempted:
      debug.recoveryAttempted ??
      debug.researchTrace?.some?.((stage) =>
        String(stage.name ?? "").toLowerCase().includes("retry"),
      ) ??
      false,

    graphContextUsed:
      debug.graphContextUsed ??
      debug.graph?.used ??
      ui.graph?.used ??
      false,

    graphifyRepoUsed:
      debug.graphifyRepoUsed ??
      debug.graphify?.used ??
      ui.graphify?.used ??
      false,

    repoGraphUsed:
      debug.repoGraphUsed ??
      debug.repoGraph?.used ??
      ui.repoGraph?.used ??
      false,
  };
}

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
    phase2: extractPhase2Signals(response),
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
