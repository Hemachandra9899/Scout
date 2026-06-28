import { afterEach, describe, expect, it, vi } from "vitest";
import {
  searchResourceCandidates,
  summarizeProviderUsage,
} from "../search-provider.js";
import { ProviderError } from "../search-providers/provider-error.js";
import type { SearchProvider } from "../search-providers/types.js";
import type { SourceTier } from "../source-types.js";

function okProvider(name: "firecrawl" | "tavily" | "github", url: string): SearchProvider {
  return {
    name,
    isConfigured: () => true,
    search: vi.fn(async () => [
      {
        title: `${name} result`,
        url,
        tier: "unknown" as SourceTier,
        reason: `From ${name}`,
        source: "web_search" as const,
        topics: [name],
        keywords: [name],
        metadata: { provider: name },
      },
    ]),
  };
}

function exhaustedProvider(name: "firecrawl" | "tavily" | "github"): SearchProvider {
  return {
    name,
    isConfigured: () => true,
    search: vi.fn(async () => {
      throw new ProviderError("exhausted", name, 429, `${name} rate limit`);
    }),
  };
}

describe("provider fallback + exhaustion signals", () => {
  const env = process.env;

  afterEach(() => {
    process.env = { ...env };
    vi.restoreAllMocks();
  });

  it("marks a provider exhausted and continues with the other", async () => {
    process.env = { ...env, FIRECRAWL_ENABLED: "true" };
    // freshness route uses tavily + firecrawl
    const tavily = okProvider("tavily", "https://docs.example.com/latest");
    const firecrawl = exhaustedProvider("firecrawl");

    const results = await searchResourceCandidates("latest api pricing changes", 5, {
      providers: [tavily, firecrawl],
    });

    expect(results.length).toBeGreaterThanOrEqual(1);

    const usage = summarizeProviderUsage(results);
    expect(usage.exhaustedProviders).toContain("firecrawl");
    expect(usage.providerFallbackUsed).toBe(true);
    expect(usage.providerErrors.some((e) => e.kind === "exhausted")).toBe(true);
    expect(usage.selectedProviders).toContain("tavily");
  });

  it("reports a disabled provider as skipped (not a failure)", async () => {
    const tavily = okProvider("tavily", "https://docs.example.com/auth");
    const firecrawl = okProvider("firecrawl", "https://docs.example.com/auth2");

    const results = await searchResourceCandidates("api authentication docs", 5, {
      providers: [tavily, firecrawl],
    });

    const usage = summarizeProviderUsage(results);
    expect(usage.skippedProviders).toContain("firecrawl");
    expect(firecrawl.search).not.toHaveBeenCalled();
  });

  it("no fallback flag when all selected providers succeed", async () => {
    process.env.FIRECRAWL_ENABLED = "true";
    const tavily = okProvider("tavily", "https://docs.example.com/a");
    const firecrawl = okProvider("firecrawl", "https://docs.example.com/b");
    const localFetch: SearchProvider = {
      name: "local_fetch",
      isConfigured: () => true,
      search: vi.fn(async () => []),
    };

    const results = await searchResourceCandidates("api authentication", 5, {
      providers: [tavily, firecrawl, localFetch],
    });

    const usage = summarizeProviderUsage(results);
    expect(usage.providerFallbackUsed).toBe(false);
    expect(usage.exhaustedProviders).toHaveLength(0);
  });
});
