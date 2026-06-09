import { describe, expect, it } from "vitest";
import { getFallbackMode, shouldRetry } from "../crawl-retry-policy.js";

describe("getFallbackMode", () => {
  it("falls back auto → dynamic", () => {
    expect(getFallbackMode("auto")).toBe("dynamic");
  });

  it("falls back dynamic → stealth", () => {
    expect(getFallbackMode("dynamic")).toBe("stealth");
  });

  it("falls back static → dynamic", () => {
    expect(getFallbackMode("static")).toBe("dynamic");
  });

  it("stealth has no fallback", () => {
    expect(getFallbackMode("stealth")).toBeUndefined();
  });
});

describe("shouldRetry", () => {
  it("does not retry when acceptedPages > 0", () => {
    const decision = shouldRetry({
      acceptedPages: 2,
      skippedPages: 0,
      failedUrls: 0,
      returnedPages: 2,
    });
    expect(decision.shouldRetry).toBe(false);
    expect(decision.reason).toBe("Content already accepted");
  });

  it("retries when pages returned but none accepted (quality reject)", () => {
    const decision = shouldRetry({
      acceptedPages: 0,
      skippedPages: 5,
      failedUrls: 0,
      returnedPages: 5,
    });
    expect(decision.shouldRetry).toBe(true);
    expect(decision.reason).toContain("retrying with fallback mode");
  });

  it("retries when some URLs failed", () => {
    const decision = shouldRetry({
      acceptedPages: 0,
      skippedPages: 0,
      failedUrls: 3,
      returnedPages: 0,
    });
    expect(decision.shouldRetry).toBe(true);
  });

  it("retries on crawl error", () => {
    const decision = shouldRetry({
      acceptedPages: 0,
      skippedPages: 0,
      failedUrls: 0,
      returnedPages: 0,
      error: "403 Forbidden",
    });
    expect(decision.shouldRetry).toBe(true);
  });

  it("does not retry with no pages, no errors", () => {
    const decision = shouldRetry({
      acceptedPages: 0,
      skippedPages: 0,
      failedUrls: 0,
      returnedPages: 0,
    });
    expect(decision.shouldRetry).toBe(false);
    expect(decision.reason).toBe("No recoverable signal");
  });
});
