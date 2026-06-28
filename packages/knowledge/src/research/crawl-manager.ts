import { crawlSiteWithScrapling } from "../scrapers/scrapling.scraper.js";
import type { ScraplingCrawlMode } from "../scrapers/scrapling.scraper.js";
import type { RankedResource, EvidenceItem } from "./source-types.js";
import { extractEvidenceFromPages } from "./evidence-extractor.js";
import { scorePageQuality, type ContentQuality } from "./crawl-quality.js";
import { getFallbackMode, shouldRetry } from "./crawl-retry-policy.js";
import type { ResourceCrawlTrace } from "./crawl-retry-policy.js";
import { checkDedupe } from "./crawl-dedupe.js";
import type { ResourceMemoryHint } from "./memory-ranking.js";
import { researchConfig } from "./research-config.js";
import { fetchUrlText } from "./local-fetch.js";

export type CrawlManagerInput = {
  projectId: string;
  query: string;
  resources: RankedResource[];
  maxPagesPerSource?: number;
  maxTotalPages?: number;
  maxDepth?: number;
  memoryHints?: ResourceMemoryHint[];
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
  rejectedByDuplicateUrl: number;
  rejectedByDuplicateContent: number;
  sourcesWithContent: number;
  sourcesSkipped: number;
  retryCount: number;
  blockedDomainCount: number;
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

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

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
  maxTotalPages: number,
  seenCanonicalUrls: Set<string>,
  seenContentHashes: Set<string>
): { accepted: number; qualityRejectCount: number; failedCount: number; dupeUrlCount: number; dupeContentCount: number } {
  let accepted = 0;
  let qualityRejectCount = 0;
  let dupeUrlCount = 0;
  let dupeContentCount = 0;

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

    const quality = scorePageQuality(page.markdown, resource.tier);

    if (quality.status === "reject") {
      skipped.push({
        title: page.title || resource.title,
        url: page.url,
        reason: `Quality check failed (score=${quality.score}): ${quality.flags.join(", ")}`,
        quality,
      });
      qualityRejectCount++;
      continue;
    }

    const dedupe = checkDedupe(page.url, page.markdown, seenCanonicalUrls, seenContentHashes);

    const crawledPage: CrawledResearchPage = {
      title: page.title || resource.title,
      url: page.url,
      markdown: page.markdown,
      depth: page.depth,
      source: resource,
      metadata: {
        ...page.metadata,
        contentQuality: quality,
        canonicalUrl: dedupe.canonicalUrl,
        contentHash: dedupe.contentHash,
        dedupeStatus: dedupe.dedupeStatus,
        rootUrl: resource.url,
        sourceTier: resource.tier,
        sourceScore: resource.score,
        matchedBy: resource.matchedBy,
      },
    };

    if (dedupe.dedupeStatus === "duplicate_url") {
      skipped.push({
        title: crawledPage.title,
        url: crawledPage.url,
        reason: `Duplicate URL: ${dedupe.canonicalUrl}`,
        quality,
      });
      dupeUrlCount++;
      continue;
    }

    if (dedupe.dedupeStatus === "duplicate_content") {
      skipped.push({
        title: crawledPage.title,
        url: crawledPage.url,
        reason: `Duplicate content hash: ${dedupe.contentHash}`,
        quality,
      });
      dupeContentCount++;
      continue;
    }

    accepted++;
    pages.push(crawledPage);
  }

  return {
    accepted,
    qualityRejectCount,
    failedCount: (crawl.failedUrls ?? []).length,
    dupeUrlCount,
    dupeContentCount,
  };
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
  const seenCanonicalUrls = new Set<string>();
  const seenContentHashes = new Set<string>();
  const blockedDomains = new Set<string>();
  for (const memory of input.memoryHints ?? []) {
    if (memory.kind === "source_failure") {
      const meta = memory.metadata as Record<string, unknown> | undefined;
      if (meta?.domain_blocked === true) {
        for (const url of memory.sourceUrls ?? []) {
          const domain = extractDomain(url);
          if (domain) blockedDomains.add(domain);
        }
      }
    }
  }
  let totalPagesCrawled = 0;
  let sourcesWithContent = 0;
  let sourcesSkipped = 0;
  let retryCount = 0;
  let blockedDomainCount = 0;
  let totalDupeUrlCount = 0;
  let totalDupeContentCount = 0;
  let totalQualityRejectCount = 0;

  async function crawlSingleResource(
    resource: RankedResource,
  ): Promise<{
    acceptedPages: CrawledResearchPage[];
    resourceTrace: ResourceCrawlTrace;
    hadContent: boolean;
    blockedDomain: boolean;
  }> {
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

    const resourceDomain = extractDomain(resource.url);
    if (resourceDomain && blockedDomains.has(resourceDomain)) {
      resourceTrace.error = `Domain blocked: ${resourceDomain}`;
      resourceTrace.pagesFailed = 1;
      return { acceptedPages: [], resourceTrace, hadContent: false, blockedDomain: true };
    }

    let currentMode = modeForResource(resource);
    let resourceAcceptedCount = 0;
    let resourceError: string | undefined;

    const localAcceptedPages: CrawledResearchPage[] = [];

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
          resource, crawl, localAcceptedPages, failed, skipped, maxTotalPages,
          seenCanonicalUrls, seenContentHashes
        );

        resourceAcceptedCount += result.accepted;
        totalQualityRejectCount += result.qualityRejectCount;
        totalDupeUrlCount += result.dupeUrlCount;
        totalDupeContentCount += result.dupeContentCount;

        if (result.accepted > 0) break;

        if (resourceDomain && result.accepted === 0 && result.failedCount > 0) {
          const allBlocked = (crawl.failedUrls ?? []).every((f) =>
            f.reason.includes("403") ||
            f.reason.toLowerCase().includes("blocked") ||
            f.reason.toLowerCase().includes("forbidden")
          );
          if (allBlocked) {
            blockedDomains.add(resourceDomain);
          }
        }

        const retryDecision = shouldRetry({
          acceptedPages: result.accepted,
          skippedPages: result.qualityRejectCount,
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

        if (resourceDomain && (errMsg.includes("403") || errMsg.toLowerCase().includes("blocked") || errMsg.toLowerCase().includes("forbidden"))) {
          blockedDomains.add(resourceDomain);
        }

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

    if (resourceAcceptedCount === 0 && resource.tier === "official_docs") {
      const direct = await fetchUrlText(resource.url);
      if (direct.ok && direct.text) {
        const directPage: CrawledResearchPage = {
          title: direct.title ?? resource.title,
          url: direct.url,
          markdown: direct.text,
          depth: 0,
          source: resource,
          metadata: { sourceTier: resource.tier, directFetch: true, url: direct.url },
        };
        localAcceptedPages.push(directPage);
        resourceAcceptedCount = 1;
        resourceTrace.directFetchUsed = true;
      }
    }

    resourceTrace.pagesAccepted = resourceAcceptedCount;
    resourceTrace.error = resourceError;
    localAcceptedPages.forEach((p) => pages.push(p));
    const hadContent = resourceAcceptedCount > 0;

    return { acceptedPages: localAcceptedPages, resourceTrace, hadContent, blockedDomain: false };
  }

  const maxConcurrent = researchConfig.fastMode ? researchConfig.maxConcurrentCrawls : 1;

  for (let i = 0; i < input.resources.length; i += maxConcurrent) {
    if (pages.length >= maxTotalPages) break;

    const batch = input.resources.slice(i, i + maxConcurrent);
    const results = await Promise.all(batch.map((r) => crawlSingleResource(r)));

    for (const result of results) {
      resourceTraces.push(result.resourceTrace);
      if (result.blockedDomain) {
        blockedDomainCount++;
        sourcesSkipped++;
        failed.push({
          title: result.resourceTrace.resourceUrl,
          url: result.resourceTrace.resourceUrl,
          reason: `Domain blocked: ${extractDomain(result.resourceTrace.resourceUrl)}`,
        });
      } else if (result.hadContent) {
        sourcesWithContent++;
      } else {
        sourcesSkipped++;
      }
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
      rejectedByQuality: totalQualityRejectCount,
      rejectedByDuplicateUrl: totalDupeUrlCount,
      rejectedByDuplicateContent: totalDupeContentCount,
      sourcesWithContent,
      sourcesSkipped,
      retryCount,
      blockedDomainCount,
      resourceTraces,
    },
  };
}
