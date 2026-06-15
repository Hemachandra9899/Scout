import type {
  AnchorGroup,
} from "./query-anchors.js";
import { requiredAnchorGroupsForQuery } from "./query-anchors.js";

export type SourceRelevanceReport = {
  passed: boolean;
  selectedCount: number;
  rejectedCount: number;
  missingRequiredGroups: string[];
  coveredGroups: string[];
};

function sourceText(source: any): string {
  return [
    source.title,
    source.name,
    source.url,
    source.sourceUrl,
    source.snippet,
    source.description,
    source.text,
    source.preview,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function groupCovered(text: string, group: AnchorGroup): boolean {
  return group.terms.some((term) => text.includes(term.toLowerCase()));
}

export function scoreSourceForQuery(source: any, query: string): number {
  const haystack = sourceText(source);
  const qTerms = query
    .toLowerCase()
    .split(/\W+/)
    .filter((term) => term.length >= 4);

  const queryHits = qTerms.filter((term) => haystack.includes(term)).length;

  const groups = requiredAnchorGroupsForQuery(query);
  const anchorHits = groups.filter((group) => groupCovered(haystack, group)).length;

  const url = String(source.url ?? source.sourceUrl ?? "").toLowerCase();
  const officialBoost =
    url.includes("developers.google.com") ||
    url.includes("developers.facebook.com") ||
    url.includes("blog.whatsapp.com") ||
    url.includes("about.fb.com") ||
    url.includes("docs.microsoft.com") ||
    url.includes("learn.microsoft.com")
      ? 4
      : 0;

  return queryHits + anchorHits * 4 + officialBoost;
}

export function filterAndRankSourcesForQuery(
  sources: any[],
  query: string,
  opts: { topK?: number; minScore?: number } = {},
): { sources: any[]; report: SourceRelevanceReport } {
  const topK = opts.topK ?? 6;
  const minScore = opts.minScore ?? 2;
  const groups = requiredAnchorGroupsForQuery(query);

  const scored = sources
    .map((source) => ({
      source,
      score: scoreSourceForQuery(source, query),
      text: sourceText(source),
    }))
    .sort((a, b) => b.score - a.score);

  const selected = scored
    .filter((item) => item.score >= minScore)
    .slice(0, topK)
    .map((item) => item.source);

  const selectedText = selected.map(sourceText).join("\n");

  const missingRequiredGroups = groups
    .filter((group) => group.required)
    .filter((group) => !groupCovered(selectedText, group))
    .map((group) => group.label);

  const coveredGroups = groups
    .filter((group) => groupCovered(selectedText, group))
    .map((group) => group.label);

  return {
    sources: selected,
    report: {
      passed: missingRequiredGroups.length === 0,
      selectedCount: selected.length,
      rejectedCount: Math.max(0, sources.length - selected.length),
      missingRequiredGroups,
      coveredGroups,
    },
  };
}
