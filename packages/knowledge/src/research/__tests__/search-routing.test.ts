import { describe, expect, it } from "vitest";
import { determineProviderRoute } from "../search-routing.js";

describe("determineProviderRoute", () => {
  it("routes code/sdk queries to github + tavily + firecrawl", () => {
    const route = determineProviderRoute("typescript sdk github repository");
    expect(route.routeKind).toBe("code");
    expect(route.selectedProviders).toContain("github");
    expect(route.selectedProviders).toContain("tavily");
    expect(route.selectedProviders).toHaveLength(4);
    expect(route.freshnessRequired).toBe(false);
  });

  it("routes freshness queries to tavily + firecrawl + local_fetch with freshness enabled", () => {
    const route = determineProviderRoute("latest Google Ads API rate limits");
    expect(route.routeKind).toBe("freshness");
    expect(route.selectedProviders).toEqual(["tavily", "firecrawl", "local_fetch"]);
    expect(route.freshnessRequired).toBe(true);
  });

  it("routes normal docs queries to tavily + firecrawl + local_fetch without freshness", () => {
    const route = determineProviderRoute(
      "Google Ads API authentication documentation"
    );
    expect(route.routeKind).toBe("docs");
    expect(route.selectedProviders).toEqual(["tavily", "firecrawl", "local_fetch"]);
    expect(route.freshnessRequired).toBe(false);
  });

  it("github in query triggers code route even without other code keywords", () => {
    const route = determineProviderRoute("example github repository");
    expect(route.routeKind).toBe("code");
    expect(route.selectedProviders).toContain("github");
  });
})
