export * from "./types.js";
export * from "./provider-error.js";
export * from "./firecrawl.provider.js";
export * from "./tavily.provider.js";
export * from "./github.provider.js";
export * from "./local-fetch.provider.js";

import type { SearchProvider } from "./types.js";
import { FirecrawlSearchProvider } from "./firecrawl.provider.js";
import { GitHubSearchProvider } from "./github.provider.js";
import { TavilySearchProvider } from "./tavily.provider.js";
import { LocalFetchSearchProvider } from "./local-fetch.provider.js";

export function getAllSearchProviders(): SearchProvider[] {
  return [
    new FirecrawlSearchProvider(),
    new TavilySearchProvider(),
    new GitHubSearchProvider(),
    new LocalFetchSearchProvider(),
  ];
}

export function getConfiguredSearchProviders(): SearchProvider[] {
  return getAllSearchProviders().filter((provider) => provider.isConfigured());
}
