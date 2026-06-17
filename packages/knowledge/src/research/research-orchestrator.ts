import { ingestMarkdownDocument } from "../ingestion/ingest-markdown-document.js";
import { SearchPlannerAgent } from "../agents/search-planner.agent.js";
import { MemoryAgent } from "../agents/memory-agent.js";
import { planResources } from "./resource-planner.js";
import { crawlResearchSources } from "./crawl-manager.js";
import { buildEvidencePack } from "./evidence-pack.js";
import { synthesizeAnswerFromEvidencePack } from "./answer-synthesizer.js";
import { researchConfig } from "./research-config.js";
import { rerankEvidenceForQuery } from "./evidence-reranker.js";
import { searchResourceCandidates } from "./search-provider.js";
import {
  extractQueryAnchors as extractQueryAnchorsModule,
  buildFocusedResearchQueries,
  missingRequiredSynthesisGroups,
  buildApiSynthesisTemplate,
} from "./query-anchors.js";
import { filterAndRankSourcesForQuery } from "./source-relevance.js";
import { buildEvidenceRecoveryPlan } from "./recovery-planner.js";
import { buildNewsQueryPlan, isNewsLikeQuery } from "./news-query-planner.js";
import { rankResourceCandidates, isFreshnessRequired } from "./source-ranker.js";
import { officialSourceSeedsForQuery } from "./official-source-catalog.js";
import { seededResourcesFromUrls } from "./seeded-resources.js";
import type {
  EvidencePack,
  RankedResource,
  SynthesizedAnswer,
} from "./source-types.js";

    export type ResearchStageTrace = {
      name: string;
      ms: number;
      ok: boolean;
      error?: string;
      data?: Record<string, unknown>;
    };

export function createResearchTrace() {
  const stages: ResearchStageTrace[] = [];
  const aborted = { current: false };

  async function timed<T>(name: string, fn: () => Promise<T>, timeoutMs?: number): Promise<T> {
    const start = Date.now();

    const runWithTimeout = async (): Promise<T> => {
      if (timeoutMs && timeoutMs > 0) {
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Stage timed out after ${timeoutMs}ms: ${name}`)), timeoutMs)
        );
        return Promise.race([fn(), timeoutPromise]);
      }
      return fn();
    };

    try {
      const result = await runWithTimeout();
      stages.push({ name, ms: Date.now() - start, ok: true });
      return result;
    } catch (error) {
      stages.push({
        name,
        ms: Date.now() - start,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
      aborted.current = true;
      throw error;
    }
  }

  return { stages, aborted, timed };
}

export type ResearchOrchestratorInput = {
  projectId: string;
  userId?: string;
  query: string;
  maxSources?: number;
  maxPagesPerSource?: number;
  maxTotalPages?: number;
  maxDepth?: number;
};

export type ResearchOrchestratorOutput = {
  status: "ok" | "partial" | "error";
  query: string;
  normalizedQuery: string;
  subqueries: Array<{ query: string; reason: string; priority: number }>;
  plan: unknown;
  resourcesPlanned: Array<{
    title: string;
    url: string;
    tier: string;
    score: number;
    source: string;
    reason: string;
    matchedBy: string[];
    metadata?: Record<string, unknown>;
  }>;
  memories: {
    retrieved: number;
    written: number;
    usedForRanking: number;
    planned: {
      sourceQuality: number;
      sourceFailure: number;
      durableFact: number;
    };
  };
  documents: Array<{
    documentId: string;
    title: string;
    url: string;
    chunksTotal: number;
    embeddedChunks: number;
    deduped: boolean;
  }>;
  failedCrawls: Array<{
    title?: string;
    url?: string;
    reason: string;
  }>;
  skippedCrawls: Array<{
    title: string;
    url: string;
    reason: string;
    quality: import("./crawl-quality.js").ContentQuality;
  }>;
  crawlTrace: import("./crawl-manager.js").CrawlTrace;
  evidencePack: EvidencePack;
  answer: SynthesizedAnswer;
  researchTrace: ResearchStageTrace[];
  debug?: {
    recoveryAttempted: boolean;
    recoveryPlan: unknown;
  };
};

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.origin + u.pathname.replace(/\/$/, "") + u.search;
  } catch {
    return url;
  }
}

function mergeResources(allResources: RankedResource[][]): RankedResource[] {
  const seen = new Map<string, RankedResource>();

  for (const batch of allResources) {
    for (const resource of batch) {
      const key = normalizeUrl(resource.url);
      const existing = seen.get(key);

      if (!existing) {
        seen.set(key, { ...resource, matchedBy: [...(resource.matchedBy ?? [])] });
        continue;
      }

      const newMatched = (resource.matchedBy ?? []).filter(
        (m) => !(existing.matchedBy ?? []).includes(m)
      );
      existing.matchedBy = [...(existing.matchedBy ?? []), ...newMatched];

      if (resource.score > existing.score) {
        existing.score = resource.score;
        existing.reason = resource.reason;
        existing.tier = resource.tier;
      }
    }
  }

  return [...seen.values()].sort((a, b) => b.score - a.score);
}

export class ResearchOrchestrator {
  constructor(
    private readonly searchPlanner = new SearchPlannerAgent(),
    private readonly memoryAgent = new MemoryAgent()
  ) {}

  async run(input: ResearchOrchestratorInput): Promise<ResearchOrchestratorOutput> {
    const trace = createResearchTrace();
    const context = {
      projectId: input.projectId,
      userId: input.userId,
      query: input.query,
    };

    const planResult = await trace.timed("plan", async () => {
      const result = this.searchPlanner.plan(context);
      if (result.status !== "ok" || !result.output) {
        throw new Error(result.error ?? "Search planning failed");
      }
      return result;
    }, researchConfig.stageTimeoutMs);

    const plan = planResult.output!;

    const memoryResult = await trace.timed("retrieve_memories", () =>
      this.memoryAgent.retrieveForRun(context),
    researchConfig.stageTimeoutMs);
    const retrievedMemories = memoryResult.output?.retrieved ?? [];
    const retrievedMemoryCount = retrievedMemories.length;

    const rankingMemories = retrievedMemories.filter((memory) =>
      ["source_quality", "source_failure", "durable_fact"].includes(memory.kind)
    );

    const maxSources = Math.max(
      6,
      input.maxSources ?? plan.recommendedMaxSources ?? 8,
    );

    const subqueries = plan.subqueries;

    const allResourceBatches: RankedResource[][] = [];

    for (const subquery of subqueries) {
      const resourcePlan = await trace.timed(`plan_resources:${subquery.query.slice(0, 40)}`, () =>
        planResources({
          query: subquery.query,
          maxSources: Math.max(5, Math.ceil(maxSources / subqueries.length)),
          memoryHints: rankingMemories,
        }),
      researchConfig.stageTimeoutMs);

      for (const resource of resourcePlan.resources) {
        if (!resource.matchedBy) {
          resource.matchedBy = [];
        }

        resource.matchedBy.push(`subquery:${subquery.query}`);
      }

      allResourceBatches.push(resourcePlan.resources);
    }

    const newsPlan = buildNewsQueryPlan(input.query);

    if (newsPlan.isNewsQuery) {
      const newsBatchQueries = newsPlan.queries.slice(0, researchConfig.fastMode ? 4 : 6);

      for (const newsQuery of newsBatchQueries) {
        const candidates = await trace.timed(`resources:news:${newsQuery.slice(0, 40)}`, () =>
          searchResourceCandidates(newsQuery, 5, {
            freshnessRequired: isFreshnessRequired(newsQuery),
          }),
        researchConfig.stageTimeoutMs);

        const ranked = rankResourceCandidates(newsQuery, candidates, {
          maxSources: Math.max(3, Math.ceil(maxSources / Math.max(newsBatchQueries.length, 1))),
          minScore: 25,
          memoryHints: rankingMemories,
          maxPerDomain: 2,
          freshnessRequired: isFreshnessRequired(newsQuery),
        });

        for (const resource of ranked) {
          if (!resource.matchedBy) resource.matchedBy = [];
          resource.matchedBy.push(`news:${newsQuery}`);
          resource.score += 300;
        }

        allResourceBatches.push(ranked);
      }
    }

    const officialSeedsList = officialSourceSeedsForQuery(input.query);
    
    if (officialSeedsList.length > 0) {
      const seededResources: RankedResource[] = officialSeedsList.flatMap((seed) => {
        const urls = seed.urls ?? [];
        return seededResourcesFromUrls(urls, seed.label).map((r) => ({
          ...r,
          score: 1000,
          matchedBy: [r.matchedBy?.[0] ?? `seed:${seed.label}`],
        }));
      });

      allResourceBatches.push(seededResources);
    }

    const mergedResources = mergeResources(allResourceBatches).slice(0, maxSources);

    let sourceRelevance = filterAndRankSourcesForQuery(mergedResources, input.query, {
      topK: researchConfig.fastMode ? 4 : 8,
      minScore: 2,
    });

    let resourcesToCrawl = sourceRelevance.sources;

    if (!sourceRelevance.report.passed || resourcesToCrawl.length === 0) {
      const focusedQueries = newsPlan.isNewsQuery
        ? newsPlan.queries
        : buildFocusedResearchQueries(input.query);
      const extraQueries = focusedQueries.filter((q) => q.toLowerCase() !== input.query.toLowerCase());

      if (extraQueries.length > 0) {
        const extraResourceBatches: RankedResource[][] = [];

        for (const focusedQuery of extraQueries) {
          const batch = await trace.timed(`plan_resources:${focusedQuery.slice(0, 40)}`, () =>
            planResources({
              query: focusedQuery,
              maxSources: Math.max(3, Math.ceil(maxSources / Math.max(extraQueries.length, 1))),
              memoryHints: rankingMemories,
            }),
          researchConfig.stageTimeoutMs);

          for (const resource of batch.resources) {
            if (!resource.matchedBy) resource.matchedBy = [];
            resource.matchedBy.push(`focused:${focusedQuery}`);
          }

          extraResourceBatches.push(batch.resources);
        }

        const extraMerged = mergeResources(extraResourceBatches);
        const allWithFocused = [...mergedResources, ...extraMerged];

        sourceRelevance = filterAndRankSourcesForQuery(allWithFocused, input.query, {
          topK: researchConfig.fastMode ? 4 : 8,
          minScore: 2,
        });

        resourcesToCrawl = sourceRelevance.sources;
      }
    }

    if (resourcesToCrawl.length === 0 || (!sourceRelevance.report.passed && mergedResources.length > 0)) {
      return {
        status: "partial",
        query: input.query,
        normalizedQuery: plan.normalizedQuery,
        subqueries: subqueries.map((sq) => ({
          query: sq.query,
          reason: sq.reason,
          priority: sq.priority,
        })),
        plan,
        resourcesPlanned: mergedResources.map((resource) => ({
          title: resource.title,
          url: resource.url,
          tier: resource.tier,
          score: resource.score,
          source: resource.source,
          reason: resource.reason,
          matchedBy: resource.matchedBy,
          ...(resource.metadata && Object.keys(resource.metadata).length > 0 ? { metadata: resource.metadata } : {}),
        })),
        memories: {
          retrieved: retrievedMemoryCount,
          written: 0,
          usedForRanking: rankingMemories.length,
          planned: { sourceQuality: 0, sourceFailure: 0, durableFact: 0 },
        },
        documents: [],
        failedCrawls: [],
        skippedCrawls: [],
        crawlTrace: {
          totalPagesCrawled: 0,
          acceptedPages: 0,
          skippedPages: 0,
          rejectedByQuality: 0,
          rejectedByDuplicateUrl: 0,
          rejectedByDuplicateContent: 0,
          sourcesWithContent: 0,
          sourcesSkipped: 0,
          retryCount: 0,
          blockedDomainCount: 0,
          resourceTraces: [],
        },
        evidencePack: {
          query: input.query,
          useCase: "general_research",
          resourcesPlanned: mergedResources,
          evidence: [],
          citationVerification: [],
          coverage: {
            hasEvidence: false,
            sourceCount: 0,
            claimCount: 0,
            uniqueSourceCount: 0,
            officialSourceCount: 0,
            supportedClaimCount: 0,
            weakClaimCount: 0,
            unsupportedClaimCount: 0,
            rawClaimCount: 0,
            filteredClaimCount: 0,
            qualityRejectedClaimCount: 0,
            duplicateRejectedClaimCount: 0,
            missing: sourceRelevance.report.missingRequiredGroups,
          },
        },
        answer: {
          status: "insufficient_evidence",
          mode: "research_summary",
          markdown: [
            "I do not have enough relevant evidence to answer this confidently.",
            "",
            sourceRelevance.report.missingRequiredGroups.length > 0
              ? `Missing required source coverage: ${sourceRelevance.report.missingRequiredGroups.join(", ")}`
              : "No sufficiently relevant sources were found.",
          ].join("\n"),
          citations: [],
          usedEvidenceCount: 0,
          supportedEvidenceCount: 0,
          weakEvidenceCount: 0,
          omittedUnsupportedCount: 0,
          confidence: 0,
          groundingAudit: {
            status: "fail",
            citationIdsReferenced: [],
            citationIdsDeclared: [],
            missingCitationIds: [],
            unusedCitationIds: [],
            unsupportedCitationIds: [],
            groundedClaimCount: 0,
            issueCount: 1,
            issues: ["No relevant sources passed the relevance gate"],
          },
        },
        researchTrace: [
          ...trace.stages,
          {
            name: "source_relevance",
            ms: 0,
            ok: false,
            error: sourceRelevance.report.missingRequiredGroups.length > 0
              ? `Missing: ${sourceRelevance.report.missingRequiredGroups.join(", ")}`
              : "No relevant sources",
            data: { report: sourceRelevance.report },
          },
        ],
        debug: { recoveryAttempted: false, recoveryPlan: null },
      };
    }

    const crawl = await trace.timed("crawl", () =>
      crawlResearchSources({
        projectId: input.projectId,
        query: plan.normalizedQuery,
        resources: resourcesToCrawl,
        memoryHints: rankingMemories,
        maxPagesPerSource:
          input.maxPagesPerSource ?? plan.recommendedMaxPagesPerSource ?? 3,
        maxTotalPages: input.maxTotalPages ?? 20,
        maxDepth: input.maxDepth ?? 1,
      }),
    researchConfig.stageTimeoutMs);

    const documents: Array<{
      documentId: string;
      title: string;
      url: string;
      chunksTotal: number;
      embeddedChunks: number;
      deduped: boolean;
    }> = [];

    if (!researchConfig.fastMode) {
      await trace.timed("ingest", async () => {
        const semaphore = Math.min(researchConfig.maxConcurrentIngest, crawl.pages.length);
        for (let i = 0; i < crawl.pages.length; i += semaphore) {
          const batch = crawl.pages.slice(i, i + semaphore);
          const results = await Promise.all(
            batch.map((page) =>
              ingestMarkdownDocument({
                projectId: input.projectId,
                sourceUrl: page.url,
                title: page.title,
                markdown: page.markdown,
                metadata: {
                  ...page.metadata,
                  provider: "scrapling",
                  researchQuery: input.query,
                  normalizedQuery: plan.normalizedQuery,
                  sourceTitle: page.source.title,
                  sourceTier: page.source.tier,
                  sourceScore: page.source.score,
                },
              })
            )
          );
          for (const ingested of results) {
            documents.push({
              documentId: ingested.document.id,
              title: (ingested.document as any).title ?? ingested.document.id,
              url: (ingested.document as any).sourceUrl ?? "",
              chunksTotal: ingested.chunksTotal,
              embeddedChunks: ingested.embeddedChunks,
              deduped: ingested.deduped,
            });
          }
        }
      }, researchConfig.stageTimeoutMs);
    }

    let recoveryAttempted = false;
    let recoveryPlanDebug: unknown = null;

    let rerankedEvidence = rerankEvidenceForQuery(
      crawl.evidence,
      input.query,
      researchConfig.rerankTopK,
    );

    let evidencePack = await trace.timed("build_evidence_pack", () =>
      Promise.resolve(buildEvidencePack({
        query: input.query,
        resourcesPlanned: mergedResources,
        evidence: rerankedEvidence,
      })),
    researchConfig.stageTimeoutMs);

    const queryAnchors = extractQueryAnchorsModule(input.query);
    const apiTemplate = buildApiSynthesisTemplate(input.query);
    const anchorContext = [
      queryAnchors.length > 0
        ? `The answer must directly address the user query.\nIf these query anchors are provided, explicitly cover them when evidence is available:\n${queryAnchors.join(", ")}\n\nIf evidence for an anchor is missing, say so instead of omitting it.\nDo not answer with unrelated content.`
        : "",
      apiTemplate,
    ].filter(Boolean).join("\n\n");

    const answer = await trace.timed("synthesize", () =>
      Promise.resolve(synthesizeAnswerFromEvidencePack({
        query: `${input.query}\n\n${anchorContext}`.trim(),
        evidencePack: {
          ...evidencePack,
          evidence: rerankedEvidence,
        },
        maxClaims: 10,
      })),
    researchConfig.stageTimeoutMs);

    const missingGroups = missingRequiredSynthesisGroups(answer.markdown, input.query);
    if (missingGroups.length > 0) {
      const focusedQuery = [
        input.query,
        "",
        `The previous answer missed these required sections: ${missingGroups.join(", ")}.`,
        "Answer with explicit sections for each:",
        ...missingGroups.map((g) => `- ${g}: (state evidence or 'Evidence not found')`),
        "",
        "If evidence is missing for a section, say 'Evidence not found' for that section.",
      ].join("\n");

      const retryAnswer = await trace.timed("synthesize_retry", () =>
        Promise.resolve(synthesizeAnswerFromEvidencePack({
          query: `${focusedQuery}\n\n${anchorContext}`.trim(),
          evidencePack: {
            ...evidencePack,
            evidence: rerankedEvidence,
          },
          maxClaims: 10,
        })),
      researchConfig.stageTimeoutMs);

      const retryMissingGroups = missingRequiredSynthesisGroups(retryAnswer.markdown, input.query);

      if (retryMissingGroups.length < missingGroups.length) {
        answer.markdown = retryAnswer.markdown;
        answer.citations = retryAnswer.citations;
        answer.usedEvidenceCount = retryAnswer.usedEvidenceCount;
        answer.supportedEvidenceCount = retryAnswer.supportedEvidenceCount;
        answer.weakEvidenceCount = retryAnswer.weakEvidenceCount;
        answer.groundingAudit = retryAnswer.groundingAudit;
        answer.confidence = retryAnswer.confidence;
        if (retryMissingGroups.length > 0 && retryAnswer.status === "answered") {
          answer.status = "partial";
        }
      }

      let finalMissing = answer.status === "partial"
        ? missingRequiredSynthesisGroups(answer.markdown, input.query)
        : [];

      if (finalMissing.length > 0) {
        answer.status = "partial";
        answer.markdown = [
          "I found some evidence, but the answer is incomplete.",
          "",
          answer.markdown,
        ].join("\n");
      }
    }

    // store pre-prefix answer for recovery checking
    const answerBody = answer.markdown;

    // Use initial missing groups (before retry papered over gaps) for recovery trigger.
    // The retry may add "Evidence not found" placeholders that satisfy the
    // missingRequiredSynthesisGroups check, but recovery should still fire to
    // try to find actual evidence for those gaps.
    const finalMissing = missingGroups.length > 0 ? missingGroups : [];

    if (finalMissing.length > 0) {
      recoveryAttempted = true;

      const recoveryQueries = [
        ...buildFocusedResearchQueries(input.query),
        ...finalMissing.flatMap((g) => [
          `${input.query} ${g}`,
          `${g} ${input.query}`,
        ]),
      ].filter((q, i, a) => a.indexOf(q) === i).slice(0, 6);

      const recoveryResources: RankedResource[] = [];

      for (const recoveryQuery of recoveryQueries) {
        const recoveryBatch = await trace.timed(
          `recovery_retry:plan_resources:${recoveryQuery.slice(0, 40)}`,
          () =>
            planResources({
              query: recoveryQuery,
              maxSources: researchConfig.fastMode ? 3 : 5,
              memoryHints: rankingMemories,
            }),
          researchConfig.stageTimeoutMs,
        );

        for (const resource of recoveryBatch.resources) {
          if (!resource.matchedBy) resource.matchedBy = [];
          resource.matchedBy.push(`recovery:${recoveryQuery}`);
          resource.score += 250;
        }

        recoveryResources.push(...recoveryBatch.resources);
      }

      const recoveryRelevance = filterAndRankSourcesForQuery(
        recoveryResources,
        input.query,
        { topK: researchConfig.fastMode ? 3 : 5, minScore: 2 },
      );

      if (recoveryRelevance.sources.length > 0) {
        const recoveryCrawl = await trace.timed(
          "recovery_retry:crawl",
          () =>
            crawlResearchSources({
              projectId: input.projectId,
              query: plan.normalizedQuery,
              resources: recoveryRelevance.sources,
              memoryHints: rankingMemories,
              maxPagesPerSource: 1,
              maxTotalPages: researchConfig.fastMode ? 3 : 6,
              maxDepth: 1,
            }),
          researchConfig.stageTimeoutMs,
        );

        const combinedEvidence = [
          ...rerankedEvidence,
          ...recoveryCrawl.evidence,
        ];

        rerankedEvidence = rerankEvidenceForQuery(
          combinedEvidence,
          input.query,
          researchConfig.rerankTopK,
        );

        evidencePack = await trace.timed(
          "recovery_retry:build_evidence_pack",
          () =>
            Promise.resolve(
              buildEvidencePack({
                query: input.query,
                resourcesPlanned: [...mergedResources, ...recoveryRelevance.sources],
                evidence: rerankedEvidence,
              }),
            ),
          researchConfig.stageTimeoutMs,
        );

        const recoveryAnswer = await trace.timed("recovery_retry:synthesize", () =>
          Promise.resolve(synthesizeAnswerFromEvidencePack({
            query: `${input.query}\n\n${anchorContext}`.trim(),
            evidencePack: {
              ...evidencePack,
              evidence: rerankedEvidence,
            },
            maxClaims: 10,
          })),
        researchConfig.stageTimeoutMs);

        const recoveryMissing = missingRequiredSynthesisGroups(recoveryAnswer.markdown, input.query);
        if (recoveryMissing.length < finalMissing.length) {
          answer.markdown = recoveryAnswer.markdown;
          answer.citations = recoveryAnswer.citations;
          answer.usedEvidenceCount = recoveryAnswer.usedEvidenceCount;
          answer.supportedEvidenceCount = recoveryAnswer.supportedEvidenceCount;
          answer.weakEvidenceCount = recoveryAnswer.weakEvidenceCount;
          answer.groundingAudit = recoveryAnswer.groundingAudit;
          answer.confidence = recoveryAnswer.confidence;
        }
        if (recoveryMissing.length > 0) {
          answer.status = "partial";
          answer.markdown = [
            "I found some evidence, but the answer is incomplete.",
            "",
            `Missing required sections: ${recoveryMissing.join(", ")}`,
            "",
            recoveryAnswer.markdown,
          ].join("\n");
        } else {
          answer.status = "answered";
        }
      }
    }

    // Post-recovery: if answer still misses query anchors, append evidence gaps
    {
      const finalAnswerMissing = missingRequiredSynthesisGroups(answer.markdown, input.query);
      const answerLower = answer.markdown.toLowerCase();
      const missingAnchors = queryAnchors.filter((a) => !answerLower.includes(a.toLowerCase()));
      if (missingAnchors.length > 0 || finalAnswerMissing.length > 0) {
        const gapSet = new Set<string>();
        for (const g of finalAnswerMissing) gapSet.add(g);
        for (const a of missingAnchors) gapSet.add(a);
        const gapItems = [...gapSet].sort();
        if (answer.status === "answered") {
          answer.status = "partial";
        }
        answer.markdown = [
          answer.markdown,
          "",
          "## Evidence gaps",
          "",
          "The following required sections or query terms are not yet fully covered:",
          "",
          ...gapItems.map((g) => `- ${g}`),
          "",
          "(The system performed an additional evidence recovery pass but could not find sufficient evidence for these items.)",
        ].join("\n");
      }
    }

    if (researchConfig.fastMode) {
      return {
        status:
          crawl.pages.length > 0
            ? crawl.failed.length > 0 || answer.status !== "answered"
              ? "partial"
              : "ok"
            : "error",
        query: input.query,
        normalizedQuery: plan.normalizedQuery,
        subqueries: subqueries.map((sq) => ({
          query: sq.query,
          reason: sq.reason,
          priority: sq.priority,
        })),
        plan,
        resourcesPlanned: mergedResources.map((resource) => ({
          title: resource.title,
          url: resource.url,
          tier: resource.tier,
          score: resource.score,
          source: resource.source,
          reason: resource.reason,
          matchedBy: resource.matchedBy,
          ...(resource.metadata && Object.keys(resource.metadata).length > 0 ? { metadata: resource.metadata } : {}),
        })),
        memories: {
          retrieved: retrievedMemoryCount,
          written: 0,
          usedForRanking: rankingMemories.length,
          planned: { sourceQuality: 0, sourceFailure: 0, durableFact: 0 },
        },
        documents,
        failedCrawls: crawl.failed,
        skippedCrawls: crawl.skipped.map((s) => ({
          title: s.title,
          url: s.url,
          reason: s.reason,
          quality: s.quality,
        })),
        crawlTrace: crawl.trace,
        evidencePack,
        answer,
        researchTrace: trace.stages,
        debug: {
          recoveryAttempted,
          recoveryPlan: recoveryPlanDebug,
        },
      };
    }

    const sourceMemoryDrafts = this.memoryAgent.buildSourceMemoriesFromEvidencePack({
      projectId: input.projectId,
      userId: input.userId,
      evidencePack,
    });

    const skippedAsFailures: Array<{
      title?: string;
      url?: string;
      reason: string;
    }> = crawl.skipped.map((s) => ({
      title: s.title,
      url: s.url,
      reason: `Skipped by quality gate: ${s.reason}`,
    }));

    const failureMemoryDrafts = this.memoryAgent.buildFailureMemoriesFromCrawlFailures({
      projectId: input.projectId,
      userId: input.userId,
      query: input.query,
      failedCrawls: [...crawl.failed, ...skippedAsFailures],
    });

    const durableFactMemoryDrafts =
      this.memoryAgent.buildDurableFactMemoriesFromEvidencePack({
        projectId: input.projectId,
        userId: input.userId,
        evidencePack,
      });

    const allMemoryDrafts = [
      ...sourceMemoryDrafts,
      ...failureMemoryDrafts,
      ...durableFactMemoryDrafts,
    ];

    const writeResult = await trace.timed("write_memories", () =>
      this.memoryAgent.writeRunMemories(context, allMemoryDrafts),
    researchConfig.stageTimeoutMs);

    return {
      status:
        documents.length > 0
          ? crawl.failed.length > 0 || answer.status !== "answered"
            ? "partial"
            : "ok"
          : "error",
      query: input.query,
      normalizedQuery: plan.normalizedQuery,
      subqueries: subqueries.map((sq) => ({
        query: sq.query,
        reason: sq.reason,
        priority: sq.priority,
      })),
      plan,
      resourcesPlanned: mergedResources.map((resource) => ({
        title: resource.title,
        url: resource.url,
        tier: resource.tier,
        score: resource.score,
        source: resource.source,
        reason: resource.reason,
        matchedBy: resource.matchedBy,
        ...(resource.metadata && Object.keys(resource.metadata).length > 0 ? { metadata: resource.metadata } : {}),
      })),
      memories: {
        retrieved: retrievedMemoryCount,
        written: writeResult.output?.written ?? 0,
        usedForRanking: rankingMemories.length,
        planned: {
          sourceQuality: sourceMemoryDrafts.length,
          sourceFailure: failureMemoryDrafts.length,
          durableFact: durableFactMemoryDrafts.length,
        },
      },
      documents,
      failedCrawls: crawl.failed,
      skippedCrawls: crawl.skipped.map((s) => ({
        title: s.title,
        url: s.url,
        reason: s.reason,
        quality: s.quality,
      })),
      crawlTrace: crawl.trace,
      evidencePack,
      answer,
      researchTrace: trace.stages,
      debug: {
        recoveryAttempted,
        recoveryPlan: recoveryPlanDebug,
      },
    };
  }
}
