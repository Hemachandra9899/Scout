export const researchConfig = {
  fastMode: process.env.RESEARCH_FAST_MODE === "1",

  maxConcurrentCrawls: Number(
    process.env.RESEARCH_MAX_CONCURRENT_CRAWLS || 2,
  ),

  maxConcurrentIngest: Number(
    process.env.RESEARCH_MAX_CONCURRENT_INGEST || 2,
  ),

  stageTimeoutMs: Number(
    process.env.RESEARCH_STAGE_TIMEOUT_MS || 90_000,
  ),

  rerankTopK: Number(
    process.env.RESEARCH_RERANK_TOP_K || 8,
  ),

  requireQueryAnchors:
    process.env.RESEARCH_SYNTHESIS_REQUIRE_QUERY_ANCHORS === "1",
};
