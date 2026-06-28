import type { SearchProvider, SearchProviderResult } from "./types.js";
import { officialSourceSeedsForQuery } from "../official-source-catalog.js";
import { seededResourcesFromUrls } from "../seeded-resources.js";

/**
 * Zero-cost fallback provider. When no paid search provider is available (or they
 * are exhausted), this surfaces known official-source URLs for the query directly
 * from the catalog, so the crawler still has trustworthy seeds to fetch.
 *
 * Disabled by default — only active when LOCAL_CRAWL_ENABLED is truthy.
 */
function enabled(): boolean {
  const v = process.env.LOCAL_CRAWL_ENABLED;
  return v === "1" || v === "true" || v === "yes";
}

export class LocalFetchSearchProvider implements SearchProvider {
  readonly name = "local_fetch" as const;

  isConfigured(): boolean {
    return enabled();
  }

  async search(input: {
    query: string;
    limit: number;
  }): Promise<SearchProviderResult[]> {
    if (!enabled()) return [];

    const seeds = officialSourceSeedsForQuery(input.query);
    const results: SearchProviderResult[] = [];

    for (const seed of seeds) {
      for (const resource of seededResourcesFromUrls(seed.urls ?? [], seed.label)) {
        results.push({
          ...resource,
          reason: "Direct local fetch of a known official source.",
          metadata: {
            ...(resource.metadata ?? {}),
            provider: this.name,
            localFetch: true,
          },
        });
      }
    }

    return results.slice(0, Math.max(1, input.limit));
  }
}
