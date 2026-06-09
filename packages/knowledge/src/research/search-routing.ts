import type { SearchProviderName } from "./search-providers/types.js";

export type RouteKind = "docs" | "freshness" | "code";

export type ProviderRoute = {
  routeKind: RouteKind;
  routeReason: string;
  selectedProviders: SearchProviderName[];
  freshnessRequired: boolean;
};

const CODE_QUERY_PATTERN =
  /\b(github|repo|repository|code|sdk|client|package|library|implementation|example|readme|open source|oss|typescript|npm|pip|go get|install)\b/i;

const FRESHNESS_QUERY_PATTERN =
  /\b(latest|current|recent|today|now|new|updated|202[4-9]|version|changelog|release|pricing|rate limit|deprecated|deprecation)\b/i;

const CODE_OVERRIDE_PATTERN = /\b(?!.*\bweather\b)(github|sdk|repo|repository)\b/i;

export function determineProviderRoute(query: string): ProviderRoute {
  const isCodeQuery = CODE_QUERY_PATTERN.test(query);
  const isFreshnessQuery = FRESHNESS_QUERY_PATTERN.test(query) && !isCodeQuery;
  const isCodeOverride = CODE_OVERRIDE_PATTERN.test(query);

  if (isCodeQuery || isCodeOverride) {
    return {
      routeKind: "code",
      routeReason: "Code, SDK, repository, or implementation query.",
      selectedProviders: ["github", "tavily", "firecrawl"],
      freshnessRequired: false,
    };
  }

  if (isFreshnessQuery) {
    return {
      routeKind: "freshness",
      routeReason: "Freshness-sensitive query detected (latest, pricing, versions, deprecations).",
      selectedProviders: ["tavily", "firecrawl"],
      freshnessRequired: true,
    };
  }

  return {
    routeKind: "docs",
    routeReason: "General documentation or API reference query.",
    selectedProviders: ["tavily", "firecrawl"],
    freshnessRequired: false,
  };
}
