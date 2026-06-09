import { describe, expect, it } from "vitest";
import { searchResourceCandidates } from "../search-provider.js";
import { FirecrawlSearchProvider } from "../search-providers/firecrawl.provider.js";
import { GitHubSearchProvider } from "../search-providers/github.provider.js";
import { TavilySearchProvider } from "../search-providers/tavily.provider.js";

const runSmoke = process.env.RUN_PROVIDER_SMOKE === "1";

function hasEnv(key: string): boolean {
  return Boolean(process.env[key]?.trim());
}

function logResults(label: string, results: Array<{ title: string; url: string; metadata?: Record<string, unknown> }>) {
  console.log(`\n${label}: ${results.length} result(s)`);
  for (const result of results.slice(0, 5)) {
    console.log(`- ${result.title} :: ${result.url} :: provider=${result.metadata?.provider ?? "unknown"}`);
  }
}

describe.runIf(runSmoke)("real search provider smoke tests", () => {
  it.runIf(hasEnv("TAVILY_API_KEY"))("Tavily returns web results", async () => {
    const provider = new TavilySearchProvider();

    const results = await provider.search({
      query: "latest Google Ads API authentication requirements",
      limit: 5,
      freshnessRequired: true,
    });

    logResults("Tavily", results);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].url).toMatch(/^https?:\/\//);
    expect(results.every((result) => result.metadata?.provider === "tavily")).toBe(true);
  }, 30_000);

  it.runIf(hasEnv("GITHUB_TOKEN"))("GitHub returns repository results for SDK/code queries", async () => {
    const provider = new GitHubSearchProvider();

    const results = await provider.search({
      query: "typescript sdk github repository api client",
      limit: 5,
    });

    logResults("GitHub", results);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].url).toContain("github.com");
    expect(results.every((result) => result.metadata?.provider === "github")).toBe(true);
  }, 30_000);

  it.runIf(hasEnv("FIRECRAWL_API_KEY"))("Firecrawl returns web results", async () => {
    const provider = new FirecrawlSearchProvider();

    const results = await provider.search({
      query: "Google Ads API authentication requirements",
      limit: 5,
    });

    logResults("Firecrawl", results);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].url).toMatch(/^https?:\/\//);
    expect(results.every((result) => result.metadata?.provider === "firecrawl")).toBe(true);
  }, 30_000);

  it.runIf(hasEnv("TAVILY_API_KEY") || hasEnv("FIRECRAWL_API_KEY") || hasEnv("GITHUB_TOKEN"))(
    "aggregated search dedupes and returns provider metadata",
    async () => {
      const providers = [
        ...(hasEnv("FIRECRAWL_API_KEY") ? [new FirecrawlSearchProvider()] : []),
        ...(hasEnv("TAVILY_API_KEY") ? [new TavilySearchProvider()] : []),
        ...(hasEnv("GITHUB_TOKEN") ? [new GitHubSearchProvider()] : []),
      ];

      const results = await searchResourceCandidates(
        "github repository sdk api client implementation example",
        8,
        {
          providers,
          freshnessRequired: true,
        }
      );

      logResults("Aggregated", results);

      const urls = results.map((result) => result.url.replace(/\/$/, ""));
      expect(results.length).toBeGreaterThan(0);
      expect(new Set(urls).size).toBe(urls.length);
      expect(results.some((result) => result.metadata?.provider)).toBe(true);
    },
    45_000
  );
});

describe.skipIf(runSmoke)("real search provider smoke tests", () => {
  it("is skipped unless RUN_PROVIDER_SMOKE=1", () => {
    expect(true).toBe(true);
  });
});
