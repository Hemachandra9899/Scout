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

    graphPathUsed:
      debug.graphPathUsed ??
      debug.graph?.pathUsed ??
      ui.graph?.pathUsed ??
      false,

    graphReportUsed:
      debug.graphReportUsed ??
      debug.graph?.reportUsed ??
      ui.graph?.reportUsed ??
      false,

    focusedRetryUsed:
      debug.focusedRetry?.focusedRetryUsed ??
      debug.focusedRetryUsed ??
      false,

    focusedRetryMs:
      debug.focusedRetry?.focusedRetryMs ??
      debug.focusedRetryMs ??
      0,

    progressEventCount:
      debug.progress?.eventCount ?? 0,

    progressStages:
      debug.progress?.stages ?? [],

    routingIntent:
      debug.routing?.intent,

    routingConfidence:
      Number(debug.routing?.confidence ?? 0),

    routeSignals:
      debug.routing?.signals ?? [],

    routeReason:
      debug.routing?.reason,

    routeSource:
      debug.routing?.source,

    analysisAngles:
      debug.routing?.analysisAngles ?? [],

    graphReportExportUsed:
      Boolean(
        debug.graphReportExportUsed ??
        debug.graphReportDownloads?.markdown ??
        debug.graph?.downloads?.markdown ??
        response?.ui?.graph?.downloads?.markdown ??
        response?.rawToolResult?.download?.markdown
      ),

    graphReportId:
      debug.graphReportId ??
      debug.graph?.reportId ??
      response?.ui?.graph?.reportId ??
      null,

    graphReportDownloadMarkdown:
      debug.graphReportDownloads?.markdown ??
      debug.graph?.downloads?.markdown ??
      response?.ui?.graph?.downloads?.markdown ??
      null,

    memoryCuratorUsed:
      Boolean(
        debug.memoryCurator?.curatorUsed ??
        debug.memory?.memoryCuratorUsed ??
        debug.memory?.curatorUsed ??
        debug.memoryTiming?.curatorUsed
      ),

    memoryWrittenCount:
      Number(
        debug.memoryCurator?.writtenCount ??
        debug.memory?.memoryWrittenCount ??
        debug.memory?.writtenCount ??
        0
      ),

    memorySkippedCount:
      Number(
        debug.memoryCurator?.skippedCount ??
        debug.memory?.memorySkippedCount ??
        debug.memory?.skippedCount ??
        0
      ),

    memoryUsedReasons:
      (debug.memory?.usedMemories ?? [])
        .map((memory) => memory.reason)
        .filter(Boolean),

    rerankerUsed:
      Boolean(
        debug.rerank?.rerankerUsed ??
        debug.retrieval?.rerank?.rerankerUsed ??
        debug.memory?.rerank?.rerankerUsed ??
        debug.graph?.rerank?.rerankerUsed ??
        response?.rawToolResult?.debug?.rerank?.rerankerUsed
      ),

    rerankerKind:
      debug.rerank?.rerankerKind ??
      debug.retrieval?.rerank?.rerankerKind ??
      debug.memory?.rerank?.rerankerKind ??
      debug.graph?.rerank?.rerankerKind ??
      null,

    rerankedCount:
      Number(
        debug.rerank?.outputCount ??
        debug.retrieval?.rerank?.outputCount ??
        debug.memory?.rerank?.outputCount ??
        debug.graph?.rerank?.outputCount ??
        0
      ),
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
