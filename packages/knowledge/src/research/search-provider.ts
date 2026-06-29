import type { ResourceCandidate } from "./source-types.js";
import { isFreshnessRequired } from "./source-ranker.js";
import { determineProviderRoute } from "./search-routing.js";
import {
  getConfiguredSearchProviders,
  type SearchProvider,
} from "./search-providers/index.js";
import type { SearchProviderName } from "./search-providers/types.js";
import { normalizeUrl } from "./search-providers/utils.js";
import { getRouteBudgets } from "./search-provider-config.js";
import {
  ProviderError,
  type ProviderErrorKind,
} from "./search-providers/provider-error.js";
import { classifyProviderError } from "./provider-errors.js";
import { cacheWrap, searchCacheKey, CACHE_SEARCH_TTL_MS } from "../cache/index.js";

export type SearchResourceCandidateOptions = {
  freshnessRequired?: boolean;
  providers?: SearchProvider[];
};

type ProviderRunTrace = {
  provider: SearchProviderName;
  status: "fulfilled" | "rejected" | "skipped";
  resultCount: number;
  budget: number;
  errorKind?: ProviderErrorKind;
  error?: string;
};

export type ProviderErrorTrace = {
  provider: SearchProviderName;
  kind: ProviderErrorKind;
  message: string;
};

/** Run-level provider reliability signals, surfaced for debug/UI. */
export type ProviderUsageSummary = {
  selectedProviders: SearchProviderName[];
  skippedProviders: SearchProviderName[];
  exhaustedProviders: SearchProviderName[];
  providerErrors: ProviderErrorTrace[];
  providerFallbackUsed: boolean;
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

async function executeProviderSearch(
  query: string,
  limit: number,
  providers: SearchProvider[],
  budgets: Record<string, { maxResults: number; enabled: boolean }>,
  freshnessRequired: boolean,
): Promise<{ merged: ResourceCandidate[]; runs: ProviderRunTrace[] }> {
  const runs: ProviderRunTrace[] = [];

  const settled = await Promise.allSettled(
    providers.map((provider) => {
      const budget = budgets[provider.name];
      return provider.search({
        query,
        limit: budget.maxResults,
        freshnessRequired,
      });
    })
  );

  const results: ResourceCandidate[] = [];

  for (let i = 0; i < settled.length; i++) {
    const item = settled[i];
    const providerName = providers[i].name;
    const budget = budgets[providerName];

    if (item.status === "fulfilled") {
      results.push(...item.value);
      runs.push({ provider: providerName, status: "fulfilled", budget: budget.maxResults, resultCount: item.value.length });
    } else {
      const reason = item.reason;
      const kind: ProviderErrorKind =
        reason instanceof ProviderError ? reason.kind : classifyProviderError(reason);
      runs.push({
        provider: providerName,
        status: "rejected",
        budget: budget.maxResults,
        resultCount: 0,
        errorKind: kind,
        error: reason instanceof Error ? reason.message : String(reason),
      });
    }
  }

  return { merged: mergeProviderResults(results).slice(0, limit * 3), runs };
}

export async function searchResourceCandidates(
  query: string,
  limit = 5,
  options: SearchResourceCandidateOptions = {}
): Promise<ResourceCandidate[]> {
  const allProviders = options.providers ?? getConfiguredSearchProviders();
  if (allProviders.length === 0) return [];

  const route = determineProviderRoute(query);
  const routeBudgets = getRouteBudgets(route.routeKind);

  const freshnessRequired =
    options.freshnessRequired ?? route.freshnessRequired ?? isFreshnessRequired(query);

  const providerByName = new Map(allProviders.map((p) => [p.name, p]));
  const selectedProviders: SearchProvider[] = [];
  const skippedRuns: ProviderRunTrace[] = [];

  for (const name of route.selectedProviders) {
    const budget = routeBudgets[name];
    if (!budget || !budget.enabled) {
      skippedRuns.push({ provider: name, status: "skipped", budget: budget?.maxResults ?? 0, resultCount: 0 });
      continue;
    }

    const provider = providerByName.get(name);
    if (!provider) {
      skippedRuns.push({ provider: name, status: "skipped", budget: budget.maxResults, resultCount: 0 });
      continue;
    }

    selectedProviders.push(provider);
  }

  if (selectedProviders.length === 0) return [];

  const cacheKeyRoute = searchCacheKey(query, limit, route.routeKind);
  const { value: { merged, runs }, cacheHit } = await cacheWrap(
    cacheKeyRoute,
    () => executeProviderSearch(query, limit, selectedProviders, routeBudgets, freshnessRequired),
    CACHE_SEARCH_TTL_MS,
  );

  const allRuns = [...skippedRuns, ...runs];
  const usage = summarizeRuns(allRuns);

  const searchTrace = {
    routeKind: route.routeKind,
    routeReason: route.routeReason,
    routeProviders: route.selectedProviders,
    ...usage,
    freshnessRequired,
    budgets: routeBudgets,
    runs: allRuns,
    cacheHit,
  };

  return merged.map((result) => ({
    ...result,
    metadata: {
      ...(result.metadata ?? {}),
      searchTrace,
    },
  }));
}

function summarizeRuns(runs: ProviderRunTrace[]): ProviderUsageSummary {
  const selectedProviders = runs
    .filter((r) => r.status !== "skipped")
    .map((r) => r.provider);
  const skippedProviders = runs
    .filter((r) => r.status === "skipped")
    .map((r) => r.provider);
  const rejected = runs.filter((r) => r.status === "rejected");

  const EXHAUSTED_KINDS = new Set<ProviderErrorKind>(["exhausted", "quota", "rate_limit"]);
  const exhaustedProviders = rejected
    .filter((r) => r.errorKind && EXHAUSTED_KINDS.has(r.errorKind))
    .map((r) => r.provider);
  const providerErrors: ProviderErrorTrace[] = rejected.map((r) => ({
    provider: r.provider,
    kind: r.errorKind ?? "error",
    message: r.error ?? "",
  }));

  const gotResults = runs.some(
    (r) => r.status === "fulfilled" && r.resultCount > 0,
  );
  const unavailable = skippedProviders.length + rejected.length;

  return {
    selectedProviders,
    skippedProviders,
    exhaustedProviders,
    providerErrors,
    providerFallbackUsed: unavailable > 0 && gotResults,
  };
}

/**
 * Merge the per-batch provider signals carried in candidate `searchTrace` metadata
 * into a single run-level summary the router/orchestrator can expose as `debug.providers`.
 */
export function summarizeProviderUsage(
  candidates: Array<{ metadata?: unknown }>,
): ProviderUsageSummary {
  const selected = new Set<SearchProviderName>();
  const skipped = new Set<SearchProviderName>();
  const exhausted = new Set<SearchProviderName>();
  const providerErrors: ProviderErrorTrace[] = [];
  const seenErrors = new Set<string>();
  let providerFallbackUsed = false;

  for (const candidate of candidates) {
    const trace = (candidate.metadata as { searchTrace?: ProviderUsageSummary })
      ?.searchTrace;
    if (!trace) continue;

    for (const p of trace.selectedProviders ?? []) selected.add(p);
    for (const p of trace.skippedProviders ?? []) skipped.add(p);
    for (const p of trace.exhaustedProviders ?? []) exhausted.add(p);
    for (const err of trace.providerErrors ?? []) {
      const key = `${err.provider}:${err.kind}:${err.message}`;
      if (seenErrors.has(key)) continue;
      seenErrors.add(key);
      providerErrors.push(err);
    }
    if (trace.providerFallbackUsed) providerFallbackUsed = true;
  }

  return {
    selectedProviders: [...selected],
    skippedProviders: [...skipped],
    exhaustedProviders: [...exhausted],
    providerErrors,
    providerFallbackUsed,
  };
}
