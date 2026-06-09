#!/usr/bin/env python3
# Apply Scout Research Engine v2 Step 17:
# Crawl retry / fallback policy.
#
# Run from Scout repo root on main AFTER Step 16.
#
# After applying:
#   npm run typecheck:knowledge
#   npm run test:knowledge

from __future__ import annotations

from pathlib import Path


ROOT = Path.cwd()


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content.strip() + "\n", encoding="utf-8")
    print(f"wrote {path}")


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def assert_repo_root() -> None:
    required = [
        "package.json",
        "packages/knowledge/src/research/crawl-manager.ts",
        "packages/knowledge/src/research/crawl-quality.ts",
        "packages/knowledge/src/research/research-orchestrator.ts",
    ]
    missing = [p for p in required if not (ROOT / p).exists()]
    if missing:
        raise SystemExit(
            "Run from Scout repo root after Step 16. Missing:\n"
            + "\n".join(f"- {p}" for p in missing)
        )


CRAWL_RETRY_POLICY_TS = r'''
import type { RankedResource } from "./source-types.js";

export type CrawlMode = "auto" | "static" | "dynamic" | "stealth";

export type CrawlAttemptSummary = {
  mode: CrawlMode;
  acceptedPages: number;
  skippedPages: number;
  failedUrls: number;
  returnedPages: number;
  error?: string;
};

export type CrawlRetryDecision = {
  shouldRetry: boolean;
  nextMode?: CrawlMode;
  reason?: string;
};

export function primaryCrawlModeForResource(resource: RankedResource): CrawlMode {
  if (resource.tier === "community" || resource.tier === "media") {
    return "dynamic";
  }

  return "auto";
}

export function fallbackCrawlModeForResource(
  resource: RankedResource,
  previousMode: CrawlMode
): CrawlMode | undefined {
  if (previousMode === "stealth") return undefined;

  if (resource.tier === "community" || resource.tier === "media") {
    return previousMode === "dynamic" ? "stealth" : "dynamic";
  }

  if (previousMode === "auto") return "dynamic";
  if (previousMode === "dynamic") return "stealth";

  return undefined;
}

export function crawlModePlanForResource(resource: RankedResource): CrawlMode[] {
  const primary = primaryCrawlModeForResource(resource);
  const fallback = fallbackCrawlModeForResource(resource, primary);

  return [...new Set([primary, fallback].filter(Boolean))] as CrawlMode[];
}

export function decideCrawlRetry(input: {
  resource: RankedResource;
  attempt: CrawlAttemptSummary;
  attemptIndex: number;
  maxAttempts: number;
}): CrawlRetryDecision {
  if (input.attemptIndex >= input.maxAttempts - 1) {
    return {
      shouldRetry: false,
      reason: "No retry remaining.",
    };
  }

  if (input.attempt.acceptedPages > 0) {
    return {
      shouldRetry: false,
      reason: "Attempt produced accepted pages.",
    };
  }

  const hasRecoverableSignal =
    Boolean(input.attempt.error) ||
    input.attempt.returnedPages > 0 ||
    input.attempt.skippedPages > 0 ||
    input.attempt.failedUrls > 0;

  if (!hasRecoverableSignal) {
    return {
      shouldRetry: false,
      reason: "Attempt produced no recoverable crawl signal.",
    };
  }

  const nextMode = fallbackCrawlModeForResource(input.resource, input.attempt.mode);
  if (!nextMode || nextMode === input.attempt.mode) {
    return {
      shouldRetry: false,
      reason: "No stronger fallback crawl mode available.",
    };
  }

  const cause = input.attempt.error
    ? `error: ${input.attempt.error}`
    : input.attempt.skippedPages > 0
      ? "all returned pages were rejected by quality gate"
      : input.attempt.failedUrls > 0
        ? "crawl returned failed URLs without accepted pages"
        : "crawl returned no accepted content";

  return {
    shouldRetry: true,
    nextMode,
    reason: `Retry with ${nextMode} because ${cause}.`,
  };
}
'''


CRAWL_MANAGER_TS = r'''
import { crawlSiteWithScrapling } from "../scrapers/scrapling.scraper.js";
import type { RankedResource, EvidenceItem } from "./source-types.js";
import { extractEvidenceFromPages } from "./evidence-extractor.js";
import { scorePageQuality, type ContentQuality } from "./crawl-quality.js";
import {
  crawlModePlanForResource,
  decideCrawlRetry,
  type CrawlMode,
} from "./crawl-retry-policy.js";

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
  mode?: CrawlMode;
  attempt?: number;
};

export type CrawlAttemptTrace = {
  mode: CrawlMode;
  attempt: number;
  returnedPages: number;
  acceptedPages: number;
  skippedPages: number;
  failedUrls: number;
  error?: string;
  retryReason?: string;
};

export type CrawlResourceTrace = {
  title: string;
  url: string;
  modesPlanned: CrawlMode[];
  attempts: CrawlAttemptTrace[];
  acceptedPages: number;
  skippedPages: number;
  failedUrls: number;
  retried: boolean;
};

export type CrawlTrace = {
  totalPagesCrawled: number;
  acceptedPages: number;
  skippedPages: number;
  rejectedByQuality: number;
  sourcesWithContent: number;
  sourcesSkipped: number;
  retryCount: number;
  resourceTraces: CrawlResourceTrace[];
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

function contentQualityMetadata(quality: ContentQuality): Record<string, unknown> {
  return {
    contentQuality: quality,
  };
}

function failedReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
  const resourceTraces: CrawlResourceTrace[] = [];
  let totalPagesCrawled = 0;
  let sourcesWithContent = 0;
  let sourcesSkipped = 0;
  let retryCount = 0;

  for (const resource of input.resources) {
    if (pages.length >= maxTotalPages) break;

    const modesPlanned = crawlModePlanForResource(resource);
    const attempts: CrawlAttemptTrace[] = [];
    const beforeAcceptedForResource = pages.length;
    const beforeSkippedForResource = skipped.length;
    const beforeFailedForResource = failed.length;

    for (let attemptIndex = 0; attemptIndex < modesPlanned.length; attemptIndex++) {
      if (pages.length >= maxTotalPages) break;

      const mode = modesPlanned[attemptIndex];
      const requestedMaxPages = Math.min(
        maxPagesPerSource,
        maxTotalPages - pages.length
      );

      const beforeAccepted = pages.length;
      const beforeSkipped = skipped.length;
      const beforeFailed = failed.length;
      let returnedPages = 0;
      let attemptError: string | undefined;

      try {
        const crawl = await crawlSiteWithScrapling({
          rootUrl: resource.url,
          maxPages: requestedMaxPages,
          maxDepth,
          mode,
          aiTargeted: true,
          sameDomainOnly: true,
        });

        for (const failedUrl of crawl.failedUrls ?? []) {
          failed.push({
            title: resource.title,
            url: failedUrl.url,
            reason: failedUrl.reason,
          });
        }

        for (const page of crawl.pages ?? []) {
          returnedPages++;
          totalPagesCrawled++;

          if (!page.markdown?.trim()) {
            continue;
          }

          const quality = scorePageQuality(page.markdown);

          const crawledPage: CrawledResearchPage = {
            title: page.title || resource.title,
            url: page.url,
            markdown: page.markdown,
            depth: page.depth,
            source: resource,
            metadata: {
              ...page.metadata,
              ...contentQualityMetadata(quality),
              crawlMode: mode,
              crawlAttempt: attemptIndex + 1,
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
              mode,
              attempt: attemptIndex + 1,
            });
            continue;
          }

          pages.push(crawledPage);

          if (pages.length >= maxTotalPages) break;
        }
      } catch (error) {
        attemptError = failedReason(error);
        failed.push({
          title: resource.title,
          url: resource.url,
          reason: `Scrapling ${mode} attempt failed: ${attemptError}`,
        });
      }

      const attemptTrace: CrawlAttemptTrace = {
        mode,
        attempt: attemptIndex + 1,
        returnedPages,
        acceptedPages: pages.length - beforeAccepted,
        skippedPages: skipped.length - beforeSkipped,
        failedUrls: failed.length - beforeFailed,
        error: attemptError,
      };

      const retryDecision = decideCrawlRetry({
        resource,
        attempt: attemptTrace,
        attemptIndex,
        maxAttempts: modesPlanned.length,
      });

      if (retryDecision.shouldRetry) {
        retryCount++;
        attemptTrace.retryReason = retryDecision.reason;
        attempts.push(attemptTrace);
        continue;
      }

      attempts.push(attemptTrace);
      break;
    }

    const acceptedForResource = pages.length - beforeAcceptedForResource;
    const skippedForResource = skipped.length - beforeSkippedForResource;
    const failedForResource = failed.length - beforeFailedForResource;

    if (acceptedForResource > 0) {
      sourcesWithContent++;
    } else if (skippedForResource > 0 || failedForResource > 0) {
      sourcesSkipped++;
    }

    resourceTraces.push({
      title: resource.title,
      url: resource.url,
      modesPlanned,
      attempts,
      acceptedPages: acceptedForResource,
      skippedPages: skippedForResource,
      failedUrls: failedForResource,
      retried: attempts.length > 1,
    });
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
'''


CRAWL_RETRY_POLICY_TEST_TS = r'''
import { describe, expect, it } from "vitest";
import {
  crawlModePlanForResource,
  decideCrawlRetry,
  fallbackCrawlModeForResource,
  primaryCrawlModeForResource,
} from "../crawl-retry-policy.js";
import type { RankedResource } from "../source-types.js";

function resource(overrides: Partial<RankedResource> = {}): RankedResource {
  return {
    title: "Docs",
    url: "https://docs.example.com",
    tier: "official_docs",
    score: 100,
    source: "registry",
    reason: "Official docs",
    matchedBy: ["registry"],
    ...overrides,
  };
}

describe("crawl retry policy", () => {
  it("uses auto then dynamic for official docs", () => {
    const r = resource({ tier: "official_docs" });
    expect(primaryCrawlModeForResource(r)).toBe("auto");
    expect(fallbackCrawlModeForResource(r, "auto")).toBe("dynamic");
    expect(crawlModePlanForResource(r)).toEqual(["auto", "dynamic"]);
  });

  it("uses dynamic then stealth for community/media", () => {
    const r = resource({ tier: "community" });
    expect(primaryCrawlModeForResource(r)).toBe("dynamic");
    expect(fallbackCrawlModeForResource(r, "dynamic")).toBe("stealth");
    expect(crawlModePlanForResource(r)).toEqual(["dynamic", "stealth"]);
  });

  it("retries when attempt has zero accepted pages but recoverable signal", () => {
    const decision = decideCrawlRetry({
      resource: resource(),
      attempt: {
        mode: "auto",
        acceptedPages: 0,
        skippedPages: 2,
        failedUrls: 0,
        returnedPages: 2,
      },
      attemptIndex: 0,
      maxAttempts: 2,
    });

    expect(decision.shouldRetry).toBe(true);
    expect(decision.nextMode).toBe("dynamic");
    expect(decision.reason).toContain("Retry with dynamic");
  });

  it("does not retry when accepted pages exist", () => {
    const decision = decideCrawlRetry({
      resource: resource(),
      attempt: {
        mode: "auto",
        acceptedPages: 1,
        skippedPages: 1,
        failedUrls: 0,
        returnedPages: 2,
      },
      attemptIndex: 0,
      maxAttempts: 2,
    });

    expect(decision.shouldRetry).toBe(false);
  });
});
'''


CRAWL_MANAGER_RETRY_TEST_TS = r'''
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RankedResource } from "../source-types.js";

const crawlSiteWithScraplingMock = vi.fn();

vi.mock("../../scrapers/scrapling.scraper.js", () => ({
  crawlSiteWithScrapling: crawlSiteWithScraplingMock,
}));

function resource(overrides: Partial<RankedResource> = {}): RankedResource {
  return {
    title: "Example API Docs",
    url: "https://docs.example.com/auth",
    tier: "official_docs",
    score: 100,
    source: "registry",
    reason: "Official docs",
    matchedBy: ["registry"],
    product: "Example API",
    domain: "docs.example.com",
    ...overrides,
  };
}

const goodMarkdown = `
# Authentication

The Example API requires OAuth access tokens for authenticated requests. Developers must create an application,
configure redirect URLs, request the required scopes, and exchange an authorization code for an access token.

## Required scopes

The API supports read and write scopes. Read scopes allow retrieval of account objects, campaign objects,
reporting resources, and configuration metadata. Write scopes allow mutation of campaign configuration after
the user grants permission. Production applications should store tokens securely and refresh them before expiry.

## Rate limits

Rate limits apply per account and per application. Clients should implement exponential backoff, retry only
idempotent operations, and log response headers for debugging quota problems.
`;

describe("crawlResearchSources retry behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retries official docs with dynamic mode when auto returns only low-quality pages", async () => {
    crawlSiteWithScraplingMock
      .mockResolvedValueOnce({
        status: "ok",
        rootUrl: "https://docs.example.com/auth",
        failedUrls: [],
        pages: [
          {
            title: "Navigation",
            url: "https://docs.example.com/nav",
            depth: 0,
            markdown: "Home\nNext\nPrevious\nLogin\nSearch",
            metadata: { provider: "scrapling" },
          },
        ],
        metadata: {},
      })
      .mockResolvedValueOnce({
        status: "ok",
        rootUrl: "https://docs.example.com/auth",
        failedUrls: [],
        pages: [
          {
            title: "Good Auth Page",
            url: "https://docs.example.com/auth",
            depth: 0,
            markdown: goodMarkdown,
            metadata: { provider: "scrapling" },
          },
        ],
        metadata: {},
      });

    const { crawlResearchSources } = await import("../crawl-manager.js");
    const result = await crawlResearchSources({
      projectId: "project_1",
      query: "Example API authentication",
      resources: [resource()],
      maxPagesPerSource: 2,
      maxTotalPages: 2,
      maxDepth: 1,
    });

    expect(crawlSiteWithScraplingMock).toHaveBeenCalledTimes(2);
    expect(crawlSiteWithScraplingMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ mode: "auto" })
    );
    expect(crawlSiteWithScraplingMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ mode: "dynamic" })
    );

    expect(result.pages).toHaveLength(1);
    expect(result.skipped).toHaveLength(1);
    expect(result.trace.retryCount).toBe(1);
    expect(result.trace.resourceTraces[0].retried).toBe(true);
    expect(result.trace.resourceTraces[0].attempts.map((a) => a.mode)).toEqual([
      "auto",
      "dynamic",
    ]);
    expect(result.pages[0].metadata).toMatchObject({
      crawlMode: "dynamic",
      crawlAttempt: 2,
    });
  });

  it("retries community pages with stealth mode after dynamic failure", async () => {
    crawlSiteWithScraplingMock
      .mockResolvedValueOnce({
        status: "ok",
        rootUrl: "https://community.example.com/post",
        failedUrls: [],
        pages: [
          {
            title: "Blocked",
            url: "https://community.example.com/post",
            depth: 0,
            markdown: "Access denied. Please enable JavaScript.",
            metadata: {},
          },
        ],
        metadata: {},
      })
      .mockResolvedValueOnce({
        status: "ok",
        rootUrl: "https://community.example.com/post",
        failedUrls: [],
        pages: [
          {
            title: "Community Post",
            url: "https://community.example.com/post",
            depth: 0,
            markdown: goodMarkdown,
            metadata: {},
          },
        ],
        metadata: {},
      });

    const { crawlResearchSources } = await import("../crawl-manager.js");
    const result = await crawlResearchSources({
      projectId: "project_1",
      query: "community answer",
      resources: [
        resource({
          tier: "community",
          url: "https://community.example.com/post",
        }),
      ],
    });

    expect(crawlSiteWithScraplingMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ mode: "dynamic" })
    );
    expect(crawlSiteWithScraplingMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ mode: "stealth" })
    );
    expect(result.trace.retryCount).toBe(1);
    expect(result.pages).toHaveLength(1);
  });

  it("does not retry when the first attempt produces accepted pages", async () => {
    crawlSiteWithScraplingMock.mockResolvedValueOnce({
      status: "ok",
      rootUrl: "https://docs.example.com/auth",
      failedUrls: [],
      pages: [
        {
          title: "Good Auth Page",
          url: "https://docs.example.com/auth",
          depth: 0,
          markdown: goodMarkdown,
          metadata: {},
        },
      ],
      metadata: {},
    });

    const { crawlResearchSources } = await import("../crawl-manager.js");
    const result = await crawlResearchSources({
      projectId: "project_1",
      query: "Example API authentication",
      resources: [resource()],
    });

    expect(crawlSiteWithScraplingMock).toHaveBeenCalledTimes(1);
    expect(result.trace.retryCount).toBe(0);
    expect(result.trace.resourceTraces[0].retried).toBe(false);
  });
});
'''


TODO_APPEND = r'''
## Done in v2 Slice 15

- [x] Added deterministic crawl retry/fallback policy.
- [x] Added official/trusted fallback `auto -> dynamic`.
- [x] Added community/media fallback `dynamic -> stealth`.
- [x] Added crawl attempt/resource traces.
- [x] Added tests for retry policy and crawl-manager retry behavior.

## Now

### Crawl reliability

- [ ] Run `npm run typecheck:knowledge`.
- [ ] Run `npm run test:knowledge`.
- [ ] Run a smoke test against a docs URL that needs dynamic rendering.
- [ ] Inspect `crawlTrace.resourceTraces[].attempts`.
- [ ] Tune retry policy only if dynamic retries are too expensive.
'''


LESSONS_APPEND = r'''
## Research Engine v2 Slice 15

- Crawl retries should be bounded and deterministic. One stronger fallback is enough for now.
- Retry only when the first attempt produced zero accepted pages.
- Retry traces must show why a stronger mode was used.
- Stealth should be reserved for community/media or dynamic fallback paths, not used by default.
'''


README_APPEND = r'''
---

## Crawl retry policy

Scout retries crawling once when the first attempt produces zero accepted pages but has recoverable signal.

Default fallback modes:

```text
official/trusted/unknown -> auto -> dynamic
community/media          -> dynamic -> stealth
```

Each retry is visible in:

```text
crawlTrace.resourceTraces[].attempts
```

This keeps crawling bounded while recovering from pages that need dynamic rendering.
'''


def patch_research_orchestrator() -> None:
    path = "packages/knowledge/src/research/research-orchestrator.ts"
    text = read(path)

    old = '''    const failureMemoryDrafts = this.memoryAgent.buildFailureMemoriesFromCrawlFailures({
      projectId: input.projectId,
      userId: input.userId,
      query: input.query,
      failedCrawls: crawl.failed,
    });'''

    new = '''    const failureMemoryDrafts = this.memoryAgent.buildFailureMemoriesFromCrawlFailures({
      projectId: input.projectId,
      userId: input.userId,
      query: input.query,
      failedCrawls: [
        ...crawl.failed,
        ...crawl.skipped.map((skipped) => ({
          title: skipped.title,
          url: skipped.url,
          reason: `Skipped low-quality crawl page: ${skipped.reason}`,
        })),
      ],
    });'''

    if old in text:
        text = text.replace(old, new)
        write(path, text)
        return

    print("skipped research-orchestrator failure-memory patch; expected block not found")


def update_index_exports() -> None:
    path = "packages/knowledge/src/index.ts"
    text = read(path)

    line = 'export * from "./research/crawl-retry-policy.js";'
    if line not in text:
        text = text.rstrip() + "\n" + line + "\n"

    write(path, text)


def append_once(path: str, heading: str, content: str) -> None:
    target = ROOT / path
    if not target.exists():
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content.strip() + "\n", encoding="utf-8")
        print(f"wrote {path}")
        return

    text = target.read_text(encoding="utf-8")
    if heading in text:
        print(f"skipped {path}; already contains {heading}")
        return

    target.write_text(text.rstrip() + "\n\n" + content.strip() + "\n", encoding="utf-8")
    print(f"updated {path}")


def main() -> None:
    assert_repo_root()

    write("packages/knowledge/src/research/crawl-retry-policy.ts", CRAWL_RETRY_POLICY_TS)
    write("packages/knowledge/src/research/crawl-manager.ts", CRAWL_MANAGER_TS)
    write("packages/knowledge/src/research/__tests__/crawl-retry-policy.test.ts", CRAWL_RETRY_POLICY_TEST_TS)
    write("packages/knowledge/src/research/__tests__/crawl-manager-retry.test.ts", CRAWL_MANAGER_RETRY_TEST_TS)

    patch_research_orchestrator()
    update_index_exports()

    append_once("README.md", "Crawl retry policy", README_APPEND)
    append_once("docs/TODO.md", "Done in v2 Slice 15", TODO_APPEND)
    append_once("docs/LESSONS.md", "Research Engine v2 Slice 15", LESSONS_APPEND)

    print("\nDone.")
    print("\nNext commands:")
    print("  npm run typecheck:knowledge")
    print("  npm run test:knowledge")
    print("")
    print("Then run a full /tools/web-research smoke test and inspect:")
    print("  crawlTrace.resourceTraces[].attempts")
    print("  skippedCrawls")
    print("  memories.planned.sourceFailure")


if __name__ == "__main__":
    main()
