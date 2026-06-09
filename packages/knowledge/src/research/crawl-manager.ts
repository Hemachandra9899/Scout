import { crawlSiteWithScrapling } from "../scrapers/scrapling.scraper.js";
import type { ScraplingCrawlMode } from "../scrapers/scrapling.scraper.js";
import type { RankedResource, EvidenceItem } from "./source-types.js";
import { extractEvidenceFromPages } from "./evidence-extractor.js";
import { scorePageQuality, type ContentQuality } from "./crawl-quality.js";
import { getFallbackMode, shouldRetry } from "./crawl-retry-policy.js";
import type { ResourceCrawlTrace } from "./crawl-retry-policy.js";

export type CrawlManagerInput = {
  projectId: string;
  query: string;
  resources: RankedResource[];
  maxPagesPerSource?: number;
  maxTotalPages?: number;
  maxDepth?: number;
};

export type CrawledResearchPage = {
  title: string;
  url: string;
  markdown: string;
  depth: number;
  source: RankedResource;
  metadata: Record<string, unknown>;
};

export type SkippedCrawl = {
  title: string;
  url: string;
  reason: string;
  quality: ContentQuality;
};

export type CrawlTrace = {
  totalPagesCrawled: number;
  acceptedPages: number;
  skippedPages: number;
  rejectedByQuality: number;
  sourcesWithContent: number;
  sourcesSkipped: number;
  retryCount: number;
  resourceTraces: ResourceCrawlTrace[];
};

export type CrawlManagerOutput = {
  pages: CrawledResearchPage[];
  evidence: EvidenceItem[];
  failed: Array<{
    title?: string;
    url?: string;
    reason: string;
  }>;
  skipped: SkippedCrawl[];
  trace: CrawlTrace;
};

export { type ResourceCrawlTrace };

function modeForResource(resource: RankedResource): ScraplingCrawlMode {
  if (resource.tier === "official_docs" || resource.tier === "trusted_docs") {
    return "auto";
  }

  if (resource.tier === "community" || resource.tier === "media") {
    return "dynamic";
  }

  return "auto";
}

function processCrawlResult(
  resource: RankedResource,
  crawl: Awaited<ReturnType<typeof crawlSiteWithScrapling>>,
  pages: CrawledResearchPage[],
  failed: CrawlManagerOutput["failed"],
  skipped: SkippedCrawl[],
  maxTotalPages: number
): { accepted: number; skipped: number; failedCount: number } {
  let accepted = 0;
  let skippedCount = 0;

  for (const failedUrl of crawl.failedUrls ?? []) {
    failed.push({
      title: resource.title,
      url: failedUrl.url,
      reason: failedUrl.reason,
    });
  }

  for (const page of crawl.pages ?? []) {
    if (pages.length >= maxTotalPages) break;
    if (!page.markdown?.trim()) continue;

    const quality = scorePageQuality(page.markdown);

    const crawledPage: CrawledResearchPage = {
      title: page.title || resource.title,
      url: page.url,
      markdown: page.markdown,
      depth: page.depth,
      source: resource,
      metadata: {
        ...page.metadata,
        contentQuality: quality,
        rootUrl: resource.url,
        sourceTier: resource.tier,
        sourceScore: resource.score,
        matchedBy: resource.matchedBy,
      },
    };

    if (quality.status === "reject") {
      skipped.push({
        title: crawledPage.title,
        url: crawledPage.url,
        reason: `Quality check failed (score=${quality.score}): ${quality.flags.join(", ")}`,
        quality,
      });
      skippedCount++;
      continue;
    }

    accepted++;
    pages.push(crawledPage);
  }

  return { accepted, skipped: skippedCount, failedCount: (crawl.failedUrls ?? []).length };
}

export async function crawlResearchSources(
  input: CrawlManagerInput
): Promise<CrawlManagerOutput> {
  const maxPagesPerSource = input.maxPagesPerSource ?? 3;
  const maxTotalPages = input.maxTotalPages ?? 20;
  const maxDepth = input.maxDepth ?? 1;

  const pages: CrawledResearchPage[] = [];
  const failed: CrawlManagerOutput["failed"] = [];
  const skipped: SkippedCrawl[] = [];
  const resourceTraces: ResourceCrawlTrace[] = [];
  let totalPagesCrawled = 0;
  let sourcesWithContent = 0;
  let sourcesSkipped = 0;
  let retryCount = 0;

  for (const resource of input.resources) {
    if (pages.length >= maxTotalPages) break;

    const resourceTrace: ResourceCrawlTrace = {
      resourceUrl: resource.url,
      tier: resource.tier,
      modesPlanned: [],
      attempts: 0,
      retried: false,
      pagesAccepted: 0,
      pagesSkipped: 0,
      pagesFailed: 0,
      error: undefined,
    };

    let currentMode = modeForResource(resource);
    let resourceAcceptedCount = 0;
    let resourceSkippedCount = 0;
    let resourceFailedCount = 0;
    let resourceError: string | undefined;

    for (let attempt = 0; attempt < 2 && currentMode; attempt++) {
      resourceTrace.modesPlanned.push(currentMode);
      resourceTrace.attempts++;

      try {
        const crawl = await crawlSiteWithScrapling({
          rootUrl: resource.url,
          maxPages: Math.min(maxPagesPerSource, maxTotalPages - pages.length),
          maxDepth,
          mode: currentMode,
          aiTargeted: true,
          sameDomainOnly: true,
        });

        totalPagesCrawled += (crawl.pages ?? []).length;

        const result = processCrawlResult(
          resource, crawl, pages, failed, skipped, maxTotalPages
        );

        resourceAcceptedCount += result.accepted;
        resourceSkippedCount += result.skipped;
        resourceFailedCount += result.failedCount;

        if (result.accepted > 0) break;

        const retryDecision = shouldRetry({
          acceptedPages: result.accepted,
          skippedPages: result.skipped,
          failedUrls: result.failedCount,
          returnedPages: (crawl.pages ?? []).length,
        });

        if (retryDecision.shouldRetry) {
          const fallback = getFallbackMode(currentMode);
          if (fallback) {
            currentMode = fallback;
            resourceTrace.retried = true;
            retryCount++;
            continue;
          }
        }
        break;
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        resourceError = errMsg;

        if (attempt === 0) {
          const fallback = getFallbackMode(currentMode);
          if (fallback) {
            currentMode = fallback;
            resourceTrace.retried = true;
            retryCount++;
            continue;
          }
        }

        failed.push({
          title: resource.title,
          url: resource.url,
          reason: errMsg,
        });
        break;
      }
    }

    resourceTrace.pagesAccepted = resourceAcceptedCount;
    resourceTrace.pagesSkipped = resourceSkippedCount;
    resourceTrace.pagesFailed = resourceFailedCount;
    resourceTrace.error = resourceError;
    resourceTraces.push(resourceTrace);

    if (resourceAcceptedCount > 0) {
      sourcesWithContent++;
    } else {
      sourcesSkipped++;
    }
  }

  const evidence = extractEvidenceFromPages(
    pages.map((page) => ({
      title: page.title,
      url: page.url,
      markdown: page.markdown,
      product: page.source.product,
      domain: page.source.domain,
      tier: page.source.tier,
      reason: page.source.reason,
      metadata: page.metadata,
    }))
  );

  return {
    pages,
    evidence,
    failed,
    skipped,
    trace: {
      totalPagesCrawled,
      acceptedPages: pages.length,
      skippedPages: skipped.length,
      rejectedByQuality: skipped.length,
      sourcesWithContent,
      sourcesSkipped,
      retryCount,
      resourceTraces,
    },
  };
}
