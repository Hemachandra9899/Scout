#!/usr/bin/env python3
# Apply Scout Research Engine v2 Step 14:
# Query-specific provider routing + provider trace metadata.
#
# Run from Scout repo root on main.
#
# Why:
# Step 12 runs all configured providers. That works, but routing should be smarter:
# - Normal web/docs queries: Tavily first, Firecrawl fallback.
# - Fresh/latest queries: Tavily first with freshness enabled, Firecrawl fallback.
# - SDK/code/repo queries: GitHub first, then Tavily/Firecrawl.
# - Official-doc/API queries: Tavily + Firecrawl, with registry still handled earlier by planResources().
#
# This patch:
# - Adds search-routing.ts.
# - Routes configured providers based on query intent.
# - Adds provider trace metadata to every returned resource.
# - Adds tests for routing and trace behavior.
# - Updates TODO and LESSONS.
#
# After applying:
#   npm run typecheck:knowledge
#   npm run test:knowledge

from __future__ import annotations

from pathlib import Path


ROOT = Path.cwd()


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content.strip() + "\n", encoding="utf-8")
    print(f"wrote {path}")


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def assert_repo_root() -> None:
    required = [
        "package.json",
        "packages/knowledge/src/research/search-provider.ts",
        "packages/knowledge/src/research/search-providers/types.ts",
        "packages/knowledge/src/research/search-providers/index.ts",
    ]
    missing = [p for p in required if not (ROOT / p).exists()]
    if missing:
        raise SystemExit(
            "Run this from Scout repo root after Step 12/13 are on main. Missing:\n"
            + "\n".join(f"- {p}" for p in missing)
        )


SEARCH_ROUTING_TS = r'''
import { isFreshnessRequired } from "./source-ranker.js";
import type {
  SearchProvider,
  SearchProviderName,
} from "./search-providers/types.js";

export type SearchRouteKind =
  | "code"
  | "freshness"
  | "official_docs"
  | "general";

export type SearchProviderRoute = {
  kind: SearchRouteKind;
  providerOrder: SearchProviderName[];
  freshnessRequired: boolean;
  reason: string;
};

const CODE_QUERY_PATTERN =
  /\b(github|repo|repository|code|sdk|client|package|library|implementation|example|readme|open source|oss)\b/i;

const OFFICIAL_DOCS_PATTERN =
  /\b(api|docs|documentation|developer docs|official docs|reference|endpoint|authentication|oauth|rate limit|permissions|schema)\b/i;

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

export function detectSearchRoute(query: string): SearchProviderRoute {
  const codeLike = CODE_QUERY_PATTERN.test(query);
  const freshness = isFreshnessRequired(query);
  const officialDocsLike = OFFICIAL_DOCS_PATTERN.test(query);

  if (codeLike) {
    return {
      kind: "code",
      providerOrder: unique(["github", "tavily", "firecrawl"]),
      freshnessRequired: freshness,
      reason: "Code, SDK, repository, or implementation query.",
    };
  }

  if (freshness) {
    return {
      kind: "freshness",
      providerOrder: unique(["tavily", "firecrawl"]),
      freshnessRequired: true,
      reason: "Freshness-sensitive query.",
    };
  }

  if (officialDocsLike) {
    return {
      kind: "official_docs",
      providerOrder: unique(["tavily", "firecrawl"]),
      freshnessRequired: false,
      reason: "Official documentation or API-reference query.",
    };
  }

  return {
    kind: "general",
    providerOrder: unique(["tavily", "firecrawl"]),
    freshnessRequired: false,
    reason: "General web research query.",
  };
}

export function routeSearchProviders(input: {
  query: string;
  providers: SearchProvider[];
  freshnessRequired?: boolean;
}): {
  route: SearchProviderRoute;
  providers: SearchProvider[];
} {
  const route = detectSearchRoute(input.query);
  const freshnessRequired = input.freshnessRequired ?? route.freshnessRequired;

  const byName = new Map(input.providers.map((provider) => [provider.name, provider]));
  const selected = route.providerOrder
    .map((name) => byName.get(name))
    .filter(Boolean) as SearchProvider[];

  const fallback = input.providers.filter(
    (provider) => !selected.some((item) => item.name === provider.name)
  );

  return {
    route: {
      ...route,
      freshnessRequired,
    },
    providers: selected.length > 0 ? selected : fallback,
  };
}
'''


SEARCH_PROVIDER_TS = r'''
import type { ResourceCandidate } from "./source-types.js";
import {
  getConfiguredSearchProviders,
  type SearchProvider,
} from "./search-providers/index.js";
import type { SearchProviderName } from "./search-providers/types.js";
import { normalizeUrl } from "./search-providers/utils.js";
import { routeSearchProviders, type SearchRouteKind } from "./search-routing.js";

export type SearchResourceCandidateOptions = {
  freshnessRequired?: boolean;
  providers?: SearchProvider[];
  disableRouting?: boolean;
};

type ProviderRunTrace = {
  provider: SearchProviderName;
  status: "fulfilled" | "rejected";
  resultCount: number;
  error?: string;
};

export type SearchProviderTrace = {
  routeKind: SearchRouteKind;
  routeReason: string;
  selectedProviders: SearchProviderName[];
  freshnessRequired: boolean;
  runs: ProviderRunTrace[];
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

function attachTraceToResults(
  results: ResourceCandidate[],
  trace: SearchProviderTrace
): ResourceCandidate[] {
  return results.map((result) => ({
    ...result,
    metadata: {
      ...(result.metadata ?? {}),
      searchTrace: trace,
    },
  }));
}

export async function searchResourceCandidates(
  query: string,
  limit = 5,
  options: SearchResourceCandidateOptions = {}
): Promise<ResourceCandidate[]> {
  const configuredProviders = options.providers ?? getConfiguredSearchProviders();
  if (configuredProviders.length === 0) return [];

  const routing = options.disableRouting
    ? {
        route: {
          kind: "general" as const,
          reason: "Routing disabled by caller.",
          freshnessRequired: options.freshnessRequired ?? false,
          providerOrder: configuredProviders.map((provider) => provider.name),
        },
        providers: configuredProviders,
      }
    : routeSearchProviders({
        query,
        providers: configuredProviders,
        freshnessRequired: options.freshnessRequired,
      });

  if (routing.providers.length === 0) return [];

  const perProviderLimit = Math.max(
    3,
    Math.ceil(limit / routing.providers.length) + 2
  );

  const settled = await Promise.allSettled(
    routing.providers.map(async (provider) => {
      const results = await provider.search({
        query,
        limit: perProviderLimit,
        freshnessRequired: routing.route.freshnessRequired,
      });

      return {
        provider: provider.name,
        results,
      };
    })
  );

  const runs: ProviderRunTrace[] = settled.map((item, index) => {
    const provider = routing.providers[index];

    if (item.status === "fulfilled") {
      return {
        provider: provider.name,
        status: "fulfilled",
        resultCount: item.value.results.length,
      };
    }

    return {
      provider: provider.name,
      status: "rejected",
      resultCount: 0,
      error: item.reason instanceof Error ? item.reason.message : String(item.reason),
    };
  });

  const results = settled.flatMap((item) =>
    item.status === "fulfilled" ? item.value.results : []
  );

  const trace: SearchProviderTrace = {
    routeKind: routing.route.kind,
    routeReason: routing.route.reason,
    selectedProviders: routing.providers.map((provider) => provider.name),
    freshnessRequired: routing.route.freshnessRequired,
    runs,
  };

  return attachTraceToResults(mergeProviderResults(results), trace).slice(
    0,
    limit * 3
  );
}
'''


SEARCH_ROUTING_TEST_TS = r'''
import { describe, expect, it, vi } from "vitest";
import {
  detectSearchRoute,
  routeSearchProviders,
} from "../search-routing.js";
import type { SearchProvider, SearchProviderName } from "../search-providers/types.js";

function provider(name: SearchProviderName): SearchProvider {
  return {
    name,
    isConfigured: () => true,
    search: vi.fn(async () => []),
  };
}

describe("detectSearchRoute", () => {
  it("routes SDK/code queries to GitHub first", () => {
    const route = detectSearchRoute("best TypeScript SDK github repository for API client");
    expect(route.kind).toBe("code");
    expect(route.providerOrder[0]).toBe("github");
  });

  it("routes latest/current queries to freshness route", () => {
    const route = detectSearchRoute("latest Google Ads API rate limits");
    expect(route.kind).toBe("freshness");
    expect(route.providerOrder).toEqual(["tavily", "firecrawl"]);
    expect(route.freshnessRequired).toBe(true);
  });

  it("routes API documentation queries to docs route", () => {
    const route = detectSearchRoute("Google Ads API authentication documentation");
    expect(route.kind).toBe("official_docs");
    expect(route.providerOrder).toEqual(["tavily", "firecrawl"]);
  });

  it("routes general queries to Tavily then Firecrawl", () => {
    const route = detectSearchRoute("best ways to research SaaS markets");
    expect(route.kind).toBe("general");
    expect(route.providerOrder).toEqual(["tavily", "firecrawl"]);
  });
});

describe("routeSearchProviders", () => {
  it("selects only configured providers in routed order", () => {
    const result = routeSearchProviders({
      query: "typescript sdk github repository",
      providers: [provider("firecrawl"), provider("tavily"), provider("github")],
    });

    expect(result.providers.map((item) => item.name)).toEqual([
      "github",
      "tavily",
      "firecrawl",
    ]);
  });

  it("falls back to available configured providers when preferred providers are missing", () => {
    const result = routeSearchProviders({
      query: "latest API pricing",
      providers: [provider("github")],
    });

    expect(result.providers.map((item) => item.name)).toEqual(["github"]);
  });
});
'''


SEARCH_PROVIDER_ROUTING_TEST_TS = r'''
import { describe, expect, it, vi } from "vitest";
import { searchResourceCandidates } from "../search-provider.js";
import type { SearchProvider, SearchProviderName } from "../search-providers/types.js";

function provider(name: SearchProviderName, url: string): SearchProvider {
  return {
    name,
    isConfigured: () => true,
    search: vi.fn(async () => [
      {
        title: `${name} result`,
        url,
        tier: "unknown",
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

describe("searchResourceCandidates routing", () => {
  it("uses GitHub first for code queries and attaches trace metadata", async () => {
    const github = provider("github", "https://github.com/example/sdk");
    const tavily = provider("tavily", "https://docs.example.com/sdk");
    const firecrawl = provider("firecrawl", "https://docs.example.com/other");

    const results = await searchResourceCandidates(
      "typescript sdk github repository",
      5,
      {
        providers: [firecrawl, tavily, github],
      }
    );

    expect(github.search).toHaveBeenCalled();
    expect(tavily.search).toHaveBeenCalled();
    expect(firecrawl.search).toHaveBeenCalled();

    const trace = results[0].metadata?.searchTrace as any;
    expect(trace.routeKind).toBe("code");
    expect(trace.selectedProviders).toEqual(["github", "tavily", "firecrawl"]);
    expect(trace.runs).toHaveLength(3);
  });

  it("uses Tavily and Firecrawl for freshness queries", async () => {
    const github = provider("github", "https://github.com/example/sdk");
    const tavily = provider("tavily", "https://docs.example.com/latest");
    const firecrawl = provider("firecrawl", "https://docs.example.com/latest-2");

    const results = await searchResourceCandidates(
      "latest API rate limits",
      5,
      {
        providers: [github, firecrawl, tavily],
      }
    );

    expect(tavily.search).toHaveBeenCalledWith(
      expect.objectContaining({ freshnessRequired: true })
    );
    expect(firecrawl.search).toHaveBeenCalledWith(
      expect.objectContaining({ freshnessRequired: true })
    );
    expect(github.search).not.toHaveBeenCalled();

    const trace = results[0].metadata?.searchTrace as any;
    expect(trace.routeKind).toBe("freshness");
    expect(trace.selectedProviders).toEqual(["tavily", "firecrawl"]);
  });

  it("can disable routing for tests or manual provider checks", async () => {
    const github = provider("github", "https://github.com/example/sdk");
    const tavily = provider("tavily", "https://docs.example.com/general");

    const results = await searchResourceCandidates("plain query", 5, {
      providers: [github, tavily],
      disableRouting: true,
    });

    expect(github.search).toHaveBeenCalled();
    expect(tavily.search).toHaveBeenCalled();
    expect((results[0].metadata?.searchTrace as any).routeReason).toBe(
      "Routing disabled by caller."
    );
  });
});
'''


README_APPEND = r'''
---

## Search provider routing

Scout routes configured search providers by query type:

```text
normal/docs query       → Tavily + Firecrawl
latest/current query    → Tavily + Firecrawl with freshness enabled
SDK/code/repo query     → GitHub + Tavily + Firecrawl
```

Every returned search candidate includes provider trace metadata:

```json
{
  "metadata": {
    "searchTrace": {
      "routeKind": "code",
      "selectedProviders": ["github", "tavily", "firecrawl"],
      "freshnessRequired": false,
      "runs": [
        { "provider": "github", "status": "fulfilled", "resultCount": 3 }
      ]
    }
  }
}
```
'''


TODO_APPEND = r'''
## Done in v2 Slice 13

- [x] Added query-specific provider routing.
- [x] Added code/freshness/docs/general search routes.
- [x] Added search provider trace metadata.
- [x] Added routing tests and search-provider routing tests.

## Now

### Provider validation

- [ ] Run `npm run typecheck:knowledge`.
- [ ] Run `npm run test:knowledge`.
- [ ] Run Tavily-only provider smoke test.
- [ ] Run GitHub-only provider smoke test.
- [ ] Run full web-research smoke test and inspect `resourcesPlanned[].metadata.searchTrace`.
'''


LESSONS_APPEND = r'''
## Research Engine v2 Slice 13

- Search provider routing should be explicit and inspectable.
- GitHub is valuable for SDK/code/repo queries, but should not run for normal freshness searches.
- Provider trace metadata makes search behavior debuggable without reading logs.
- Routing should be easy to override for tests and smoke checks.
'''


def update_index_exports() -> None:
    path = "packages/knowledge/src/index.ts"
    text = read(path)

    line = 'export * from "./research/search-routing.js";'
    if line not in text:
        text = text.rstrip() + "\n" + line + "\n"

    write(path, text)


def append_once(path: str, heading: str, content: str) -> None:
    target = ROOT / path
    if not target.exists():
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content.strip() + "\n", encoding="utf-8")
        print(f"wrote {path}")
        return

    text = target.read_text(encoding="utf-8")
    if heading in text:
        print(f"skipped {path}; already contains {heading}")
        return

    target.write_text(text.rstrip() + "\n\n" + content.strip() + "\n", encoding="utf-8")
    print(f"updated {path}")


def main() -> None:
    assert_repo_root()

    write("packages/knowledge/src/research/search-routing.ts", SEARCH_ROUTING_TS)
    write("packages/knowledge/src/research/search-provider.ts", SEARCH_PROVIDER_TS)
    write("packages/knowledge/src/research/__tests__/search-routing.test.ts", SEARCH_ROUTING_TEST_TS)
    write("packages/knowledge/src/research/__tests__/search-provider-routing.test.ts", SEARCH_PROVIDER_ROUTING_TEST_TS)

    update_index_exports()
    append_once("README.md", "Search provider routing", README_APPEND)
    append_once("docs/TODO.md", "Done in v2 Slice 13", TODO_APPEND)
    append_once("docs/LESSONS.md", "Research Engine v2 Slice 13", LESSONS_APPEND)

    print("\nDone.")
    print("\nNext commands:")
    print("  npm run typecheck:knowledge")
    print("  npm run test:knowledge")
    print("")
    print("Then run provider smoke tests:")
    print("  RUN_PROVIDER_SMOKE=1 TAVILY_API_KEY=... npm run test:providers")
    print("  RUN_PROVIDER_SMOKE=1 GITHUB_TOKEN=... npm run test:providers")


if __name__ == "__main__":
    main()
