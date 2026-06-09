import type { ScraplingCrawlMode } from "../scrapers/scrapling.scraper.js";

export type RetryDecision = {
  shouldRetry: boolean;
  fallbackMode?: ScraplingCrawlMode;
  reason?: string;
};

export type RetryAttemptResult = {
  acceptedPages: number;
  skippedPages: number;
  failedUrls: number;
  returnedPages: number;
  error?: string;
};

export type ResourceCrawlTrace = {
  resourceUrl: string;
  tier: string;
  modesPlanned: ScraplingCrawlMode[];
  attempts: number;
  retried: boolean;
  pagesAccepted: number;
  pagesSkipped: number;
  pagesFailed: number;
  error?: string;
};

export function getFallbackMode(
  mode: ScraplingCrawlMode
): ScraplingCrawlMode | undefined {
  const fallbacks: Record<ScraplingCrawlMode, ScraplingCrawlMode | undefined> = {
    auto: "dynamic",
    dynamic: "stealth",
    static: "dynamic",
    stealth: undefined,
  };
  return fallbacks[mode];
}

export function shouldRetry(result: RetryAttemptResult): RetryDecision {
  if (result.acceptedPages > 0) {
    return { shouldRetry: false, reason: "Content already accepted" };
  }

  const hasRecoverableSignal =
    result.skippedPages > 0 ||
    result.failedUrls > 0 ||
    result.returnedPages > 0 ||
    Boolean(result.error);

  if (!hasRecoverableSignal) {
    return { shouldRetry: false, reason: "No recoverable signal" };
  }

  if (result.acceptedPages === 0 && result.error) {
    if (result.error.includes("403") || result.error.includes("blocked")) {
      return { shouldRetry: true, reason: `Crawl blocked (${result.error}), retrying with fallback mode` };
    }
    if (result.error.includes("429") || result.error.includes("rate limit")) {
      return { shouldRetry: true, reason: `Rate limited (${result.error}), retrying with fallback mode` };
    }
    return { shouldRetry: true, reason: `Crawl error (${result.error}), retrying with fallback mode` };
  }

  if (result.acceptedPages === 0 && result.returnedPages > 0) {
    return { shouldRetry: true, reason: `${result.returnedPages} pages returned but none accepted (${result.skippedPages} skipped), retrying with fallback mode` };
  }

  if (result.acceptedPages === 0 && result.failedUrls > 0) {
    return { shouldRetry: true, reason: `${result.failedUrls} URLs failed, retrying with fallback mode` };
  }

  return { shouldRetry: false, reason: "No retry warranted" };
}
