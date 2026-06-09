import type { ResourceCandidate } from "./source-types.js";
import { isFreshnessRequired } from "./source-ranker.js";
import { determineProviderRoute } from "./search-routing.js";
import {
  getConfiguredSearchProviders,
  type SearchProvider,
} from "./search-providers/index.js";
import type { SearchProviderName } from "./search-providers/types.js";
import { normalizeUrl } from "./search-providers/utils.js";

export type SearchResourceCandidateOptions = {
  freshnessRequired?: boolean;
  providers?: SearchProvider[];
};

type ProviderRunTrace = {
  provider: SearchProviderName;
  status: "fulfilled" | "rejected" | "skipped";
  resultCount: number;
};

function mergeProviderResults(results: ResourceCandidate[]): ResourceCandidate[] {
  const byUrl = new Map<string, ResourceCandidate>();

  for (const result of results) {
    const key = normalizeUrl(result.url);
    const existing = byUrl.get(key);

    if (!existing) {
      byUrl.set(key, result);
      continue;
    }

    byUrl.set(key, {
      ...existing,
      publishedAt: existing.publishedAt ?? result.publishedAt,
      topics: [...new Set([...(existing.topics ?? []), ...(result.topics ?? [])])],
      keywords: [
        ...new Set([...(existing.keywords ?? []), ...(result.keywords ?? [])]),
      ],
      metadata: {
        ...(existing.metadata ?? {}),
        alternateProviders: [
          ...new Set([
            ...((existing.metadata?.alternateProviders as string[]) ?? []),
            result.metadata?.provider as string,
          ].filter(Boolean)),
        ],
      },
      reason: `${existing.reason} Also discovered by ${result.metadata?.provider ?? "another provider"}.`,
    });
  }

  return [...byUrl.values()];
}

export async function searchResourceCandidates(
  query: string,
  limit = 5,
  options: SearchResourceCandidateOptions = {}
): Promise<ResourceCandidate[]> {
  const allProviders = options.providers ?? getConfiguredSearchProviders();
  if (allProviders.length === 0) return [];

  const route = determineProviderRoute(query);

  const freshnessRequired =
    options.freshnessRequired ?? route.freshnessRequired ?? isFreshnessRequired(query);

  const providerByName = new Map(allProviders.map((p) => [p.name, p]));
  const selectedProviders: SearchProvider[] = [];
  const runs: ProviderRunTrace[] = [];

  for (const name of route.selectedProviders) {
    const provider = providerByName.get(name);
    if (provider) {
      selectedProviders.push(provider);
    } else {
      runs.push({ provider: name, status: "skipped", resultCount: 0 });
    }
  }

  if (selectedProviders.length === 0) return [];

  const perProviderLimit = Math.max(3, Math.ceil(limit / selectedProviders.length) + 2);

  const settled = await Promise.allSettled(
    selectedProviders.map((provider) =>
      provider.search({
        query,
        limit: perProviderLimit,
        freshnessRequired,
      })
    )
  );

  const results: ResourceCandidate[] = [];

  for (let i = 0; i < settled.length; i++) {
    const item = settled[i];
    const providerName = selectedProviders[i].name;

    if (item.status === "fulfilled") {
      results.push(...item.value);
      runs.push({ provider: providerName, status: "fulfilled", resultCount: item.value.length });
    } else {
      runs.push({ provider: providerName, status: "rejected", resultCount: 0 });
    }
  }

  const merged = mergeProviderResults(results).slice(0, limit * 3);

  const searchTrace = {
    routeKind: route.routeKind,
    routeReason: route.routeReason,
    selectedProviders: route.selectedProviders,
    freshnessRequired,
    runs,
  };

  return merged.map((result) => ({
    ...result,
    metadata: {
      ...(result.metadata ?? {}),
      searchTrace,
    },
  }));
}
