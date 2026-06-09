import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RankedResource } from "../source-types.js";
import type { ScraplingCrawlOutput } from "../../scrapers/scrapling.scraper.js";

const crawlSiteWithScraplingMock = vi.fn();

vi.mock("../../scrapers/scrapling.scraper.js", () => ({
  crawlSiteWithScrapling: crawlSiteWithScraplingMock,
}));

function resource(overrides: Partial<RankedResource> = {}): RankedResource {
  return {
    title: "Test Docs",
    url: "https://docs.example.com/test",
    tier: "official_docs",
    score: 100,
    source: "registry",
    reason: "Test resource",
    matchedBy: ["registry"],
    ...overrides,
  };
}

function makeCrawlResult(overrides: Partial<ScraplingCrawlOutput> = {}): ScraplingCrawlOutput {
  return {
    status: "ok",
    rootUrl: "https://docs.example.com/test",
    pages: [],
    failedUrls: [],
    metadata: {},
    ...overrides,
  };
}

describe("crawlResearchSources retry behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retries official resource when all pages are rejected by quality", async () => {
    crawlSiteWithScraplingMock.mockResolvedValueOnce(
      makeCrawlResult({
        pages: [
          {
            status: "ok",
            url: "https://docs.example.com/test/page1",
            title: "Page 1",
            markdown: "short",
            depth: 0,
            metadata: {},
          },
        ],
        failedUrls: [],
      })
    );

    crawlSiteWithScraplingMock.mockResolvedValueOnce(
      makeCrawlResult({
        pages: [
          {
            status: "ok",
            url: "https://docs.example.com/test/page1",
            title: "Page 1",
            markdown:
              "# Authentication Guide\n\nThis comprehensive guide explains how authentication works in our API system. You will learn about OAuth 2.0 flows, token management, and security best practices for production environments. We cover access tokens, refresh tokens, and client credentials grant types with detailed examples for each use case.",
            depth: 0,
            metadata: {},
          },
        ],
        failedUrls: [],
      })
    );

    const { crawlResearchSources } = await import("../crawl-manager.js");

    const result = await crawlResearchSources({
      projectId: "project_1",
      query: "test query",
      resources: [resource()],
      maxPagesPerSource: 3,
      maxTotalPages: 10,
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

    expect(result.pages.length).toBe(1);
    expect(result.trace.retryCount).toBe(1);
    expect(result.trace.resourceTraces).toHaveLength(1);
    expect(result.trace.resourceTraces[0].retried).toBe(true);
    expect(result.trace.resourceTraces[0].modesPlanned).toEqual(["auto", "dynamic"]);
    expect(result.trace.resourceTraces[0].attempts).toBe(2);
    expect(result.trace.resourceTraces[0].pagesAccepted).toBe(1);
  });

  it("retries community resource with stealth mode on dynamic failure", async () => {
    const communityRes = resource({ tier: "community" });

    crawlSiteWithScraplingMock.mockResolvedValueOnce(
      makeCrawlResult({
        pages: [
          {
            status: "ok",
            url: "https://docs.example.com/test/page1",
            title: "Page 1",
            markdown: "tiny",
            depth: 0,
            metadata: {},
          },
        ],
        failedUrls: [],
      })
    );

    crawlSiteWithScraplingMock.mockResolvedValueOnce(
      makeCrawlResult({
        pages: [
          {
            status: "ok",
            url: "https://docs.example.com/test/page1",
            title: "Page 1",
            markdown:
              "# Authentication Guide\n\nThis comprehensive guide explains how authentication works in our API system. You will learn about OAuth 2.0 flows, token management, and security best practices for production environments. We cover access tokens, refresh tokens, and client credentials grant types with detailed examples for each use case.",
            depth: 0,
            metadata: {},
          },
        ],
        failedUrls: [],
      })
    );

    const { crawlResearchSources } = await import("../crawl-manager.js");

    const result = await crawlResearchSources({
      projectId: "project_1",
      query: "test query",
      resources: [communityRes],
      maxPagesPerSource: 3,
      maxTotalPages: 10,
      maxDepth: 1,
    });

    expect(crawlSiteWithScraplingMock).toHaveBeenCalledTimes(2);
    expect(crawlSiteWithScraplingMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ mode: "dynamic" })
    );
    expect(crawlSiteWithScraplingMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ mode: "stealth" })
    );

    expect(result.trace.retryCount).toBe(1);
    expect(result.trace.resourceTraces[0].retried).toBe(true);
    expect(result.trace.resourceTraces[0].modesPlanned).toEqual(["dynamic", "stealth"]);
  });

  it("does not retry when first attempt succeeds", async () => {
    crawlSiteWithScraplingMock.mockResolvedValueOnce(
      makeCrawlResult({
        pages: [
          {
            status: "ok",
            url: "https://docs.example.com/test/page1",
            title: "Page 1",
            markdown:
              "# Authentication Guide\n\nThis comprehensive guide explains how authentication works in our API system. You will learn about OAuth 2.0 flows, token management, and security best practices for production environments. We cover access tokens, refresh tokens, and client credentials grant types with detailed examples for each use case.",
            depth: 0,
            metadata: {},
          },
        ],
        failedUrls: [],
      })
    );

    const { crawlResearchSources } = await import("../crawl-manager.js");

    const result = await crawlResearchSources({
      projectId: "project_1",
      query: "test query",
      resources: [resource()],
      maxPagesPerSource: 3,
      maxTotalPages: 10,
      maxDepth: 1,
    });

    expect(crawlSiteWithScraplingMock).toHaveBeenCalledTimes(1);
    expect(result.trace.retryCount).toBe(0);
    expect(result.trace.resourceTraces[0].retried).toBe(false);
    expect(result.trace.resourceTraces[0].modesPlanned).toEqual(["auto"]);
    expect(result.trace.resourceTraces[0].attempts).toBe(1);
  });

  it("retries on crawl error with fallback mode", async () => {
    crawlSiteWithScraplingMock.mockRejectedValueOnce(new Error("403 Forbidden"));

    crawlSiteWithScraplingMock.mockResolvedValueOnce(
      makeCrawlResult({
        pages: [
          {
            status: "ok",
            url: "https://docs.example.com/test/page1",
            title: "Page 1",
            markdown:
              "# Authentication Guide\n\nThis comprehensive guide explains how authentication works in our API system. You will learn about OAuth 2.0 flows, token management, and security best practices for production environments. We cover access tokens, refresh tokens, and client credentials grant types with detailed examples for each use case.",
            depth: 0,
            metadata: {},
          },
        ],
        failedUrls: [],
      })
    );

    const { crawlResearchSources } = await import("../crawl-manager.js");

    const result = await crawlResearchSources({
      projectId: "project_1",
      query: "test query",
      resources: [resource()],
      maxPagesPerSource: 3,
      maxTotalPages: 10,
      maxDepth: 1,
    });

    expect(crawlSiteWithScraplingMock).toHaveBeenCalledTimes(2);
    expect(crawlSiteWithScraplingMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ mode: "dynamic" })
    );

    expect(result.pages.length).toBe(1);
    expect(result.trace.retryCount).toBe(1);
    expect(result.trace.resourceTraces[0].retried).toBe(true);
    expect(result.trace.resourceTraces[0].attempts).toBe(2);
  });

  it("does not retry when stealth has no fallback", async () => {
    const stealthRes = resource({ tier: "media" });

    crawlSiteWithScraplingMock.mockResolvedValueOnce(
      makeCrawlResult({
        pages: [
          {
            status: "ok",
            url: "https://docs.example.com/test/page1",
            title: "Page 1",
            markdown: "tiny",
            depth: 0,
            metadata: {},
          },
        ],
        failedUrls: [],
      })
    );

    crawlSiteWithScraplingMock.mockResolvedValueOnce(
      makeCrawlResult({
        pages: [
          {
            status: "ok",
            url: "https://docs.example.com/test/page1",
            title: "Page 1",
            markdown: "also short",
            depth: 0,
            metadata: {},
          },
        ],
        failedUrls: [],
      })
    );

    const { crawlResearchSources } = await import("../crawl-manager.js");

    const result = await crawlResearchSources({
      projectId: "project_1",
      query: "test query",
      resources: [stealthRes],
      maxPagesPerSource: 3,
      maxTotalPages: 10,
      maxDepth: 1,
    });

    expect(crawlSiteWithScraplingMock).toHaveBeenCalledTimes(2);
    expect(result.trace.retryCount).toBe(1);
    expect(result.trace.resourceTraces[0].modesPlanned).toEqual(["dynamic", "stealth"]);

    const firstCall = crawlSiteWithScraplingMock.mock.calls[0][0];
    const secondCall = crawlSiteWithScraplingMock.mock.calls[1][0];
    expect(firstCall.mode).toBe("dynamic");
    expect(secondCall.mode).toBe("stealth");
  });
});
