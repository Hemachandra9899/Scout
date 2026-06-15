import type { RankedResource } from "./source-types.js";

export function seededResourcesFromUrls(
  urls: string[],
  label: string,
): RankedResource[] {
  return urls.map((url) => ({
    url,
    sourceUrl: url,
    title: label,
    sourceTitle: label,
    snippet: `Official source seed for ${label}`,
    description: `Official source seed for ${label}`,
    domains: [],
    keywords: [],
    topics: [],
    product: label,
    source: "web_search" as const,
    tier: "official_docs" as const,
    reason: `Official source seed for ${label}`,
    score: 100,
    matchedBy: [`seed:${label}`],
    metadata: { seeded: true },
  }));
}
