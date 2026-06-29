import type { SearchProvider, SearchProviderResult } from "./types.js";
import { officialSourceSeedsForQuery } from "../official-source-catalog.js";
import { seededResourcesFromUrls } from "../seeded-resources.js";

/**
 * Zero-cost fallback provider. Surfaces known official-source URLs for the
 * query directly from the catalog, so the crawler has trustworthy seeds to
 * fetch. Enabled by default; budget controls usage.
 */
export class LocalFetchSearchProvider implements SearchProvider {
  readonly name = "local_fetch" as const;

  isConfigured(): boolean {
    return true;
  }

  async search(input: {
    query: string;
    limit: number;
  }): Promise<SearchProviderResult[]> {

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
