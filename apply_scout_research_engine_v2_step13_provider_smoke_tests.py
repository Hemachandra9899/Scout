#!/usr/bin/env python3
# Apply Scout Research Engine v2 Step 13:
# Real provider smoke tests for Firecrawl + Tavily + GitHub.
#
# Run from Scout repo root AFTER Step 12 is applied locally.
#
# This patch:
# - Adds provider-smoke.test.ts with real API smoke tests.
# - Smoke tests are skipped unless RUN_PROVIDER_SMOKE=1.
# - Adds package/root scripts:
#     npm run test:providers
#     npm --workspace packages/knowledge run test:providers
# - Updates README/TODO/LESSONS.
#
# Usage:
#   RUN_PROVIDER_SMOKE=1 TAVILY_API_KEY=... npm run test:providers
#   RUN_PROVIDER_SMOKE=1 GITHUB_TOKEN=... npm run test:providers
#   RUN_PROVIDER_SMOKE=1 FIRECRAWL_API_KEY=... TAVILY_API_KEY=... npm run test:providers
#
# No DB migration required.

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path.cwd()


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content.strip() + "\n", encoding="utf-8")
    print(f"wrote {path}")


def read_json(path: str) -> dict:
    return json.loads((ROOT / path).read_text(encoding="utf-8"))


def write_json(path: str, data: dict) -> None:
    (ROOT / path).write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    print(f"updated {path}")


def assert_repo_root() -> None:
    required = [
        "package.json",
        "packages/knowledge/package.json",
        "packages/knowledge/src/research/search-provider.ts",
        "packages/knowledge/src/research/search-providers/tavily.provider.ts",
        "packages/knowledge/src/research/search-providers/github.provider.ts",
        "packages/knowledge/src/research/search-providers/firecrawl.provider.ts",
    ]
    missing = [p for p in required if not (ROOT / p).exists()]
    if missing:
        raise SystemExit(
            "Run this after Step 12 is applied locally. Missing:\n"
            + "\n".join(f"- {p}" for p in missing)
        )


PROVIDER_SMOKE_TEST_TS = r'''
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
'''


README_APPEND = r'''
---

## Provider smoke tests

Provider smoke tests call real external APIs and are skipped by default.

Run Tavily only:

```bash
RUN_PROVIDER_SMOKE=1 TAVILY_API_KEY=... npm run test:providers
```

Run GitHub only:

```bash
RUN_PROVIDER_SMOKE=1 GITHUB_TOKEN=... npm run test:providers
```

Run Firecrawl + Tavily:

```bash
RUN_PROVIDER_SMOKE=1 FIRECRAWL_API_KEY=... TAVILY_API_KEY=... npm run test:providers
```

Brave is intentionally not used.
'''


TODO_APPEND = r'''
## Done in v2 Slice 12

- [x] Added real provider smoke tests gated behind `RUN_PROVIDER_SMOKE=1`.
- [x] Added smoke tests for Tavily, GitHub, Firecrawl, and aggregated provider search.
- [x] Added root/package scripts for provider smoke tests.

## Now

### Real provider validation

- [ ] Run Tavily-only provider smoke test.
- [ ] Run GitHub-only provider smoke test.
- [ ] Run Firecrawl + Tavily provider smoke test if Firecrawl key is available.
- [ ] Inspect returned domains and tune provider budgets if needed.
- [ ] Commit and push Step 12 + Step 13 changes.
'''


LESSONS_APPEND = r'''
## Research Engine v2 Slice 12

- Real provider tests should be opt-in because they call paid/rate-limited external APIs.
- Provider smoke tests should validate contract shape, not exact search result content.
- Aggregated provider tests should check dedupe and provider metadata.
- Keep Brave disabled if it is not part of the current cost plan.
'''


def update_package_scripts() -> None:
    pkg = read_json("packages/knowledge/package.json")
    scripts = pkg.setdefault("scripts", {})
    scripts["test:providers"] = "vitest run src/research/__tests__/provider-smoke.test.ts"
    write_json("packages/knowledge/package.json", pkg)

    root_pkg = read_json("package.json")
    root_scripts = root_pkg.setdefault("scripts", {})
    root_scripts["test:providers"] = "npm --workspace packages/knowledge run test:providers"
    write_json("package.json", root_pkg)


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

    write(
        "packages/knowledge/src/research/__tests__/provider-smoke.test.ts",
        PROVIDER_SMOKE_TEST_TS,
    )

    update_package_scripts()
    append_once("README.md", "Provider smoke tests", README_APPEND)
    append_once("docs/TODO.md", "Done in v2 Slice 12", TODO_APPEND)
    append_once("docs/LESSONS.md", "Research Engine v2 Slice 12", LESSONS_APPEND)

    print("\nDone.")
    print("\nNext commands:")
    print("  npm run typecheck:knowledge")
    print("  npm run test:knowledge")
    print("")
    print("Real provider smoke tests:")
    print("  RUN_PROVIDER_SMOKE=1 TAVILY_API_KEY=... npm run test:providers")
    print("  RUN_PROVIDER_SMOKE=1 GITHUB_TOKEN=... npm run test:providers")
    print("  RUN_PROVIDER_SMOKE=1 FIRECRAWL_API_KEY=... TAVILY_API_KEY=... npm run test:providers")
    print("")
    print("Then commit + push Step 12 and Step 13.")


if __name__ == "__main__":
    main()
