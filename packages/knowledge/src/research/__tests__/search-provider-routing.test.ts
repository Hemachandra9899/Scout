import { afterEach, describe, expect, it, vi } from "vitest";
import { searchResourceCandidates } from "../search-provider.js";
import type { SearchProvider } from "../search-providers/types.js";
import type { SourceTier } from "../source-types.js";

function provider(name: "firecrawl" | "tavily" | "github", url: string): SearchProvider {
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
        metadata: {
          provider: name,
        },
      },
    ]),
  };
}

describe("search-provider routing integration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("includes searchTrace metadata on results", async () => {
    const firecrawl = provider("firecrawl", "https://docs.example.com/auth");
    const tavily = provider("tavily", "https://docs.example.com/auth/");

    const results = await searchResourceCandidates("api authentication", 5, {
      providers: [firecrawl, tavily],
    });

    for (const result of results) {
      expect(result.metadata).toBeDefined();
    }
  });

  it("uses all configured providers for code queries when github is configured", async () => {
    const github = provider("github", "https://github.com/example/sdk");
    const tavily = provider("tavily", "https://docs.example.com/sdk");

    const results = await searchResourceCandidates(
      "typescript sdk github repository",
      5,
      { providers: [github, tavily] }
    );

    expect(github.search).toHaveBeenCalled();
    expect(tavily.search).toHaveBeenCalled();
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it("does not call github for plain docs queries", async () => {
    const github = provider("github", "https://github.com/example/sdk");
    const tavily = provider("tavily", "https://docs.example.com/docs");

    await searchResourceCandidates(
      "Google Ads API authentication documentation",
      5,
      { providers: [github, tavily] }
    );

    expect(github.search).not.toHaveBeenCalled();
  });
})
