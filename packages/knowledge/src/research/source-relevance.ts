import type {
  AnchorGroup,
} from "./query-anchors.js";
import { requiredAnchorGroupsForQuery } from "./query-anchors.js";
import { buildNewsQueryPlan, isNewsLikeQuery } from "./news-query-planner.js";

export type GroupCoverage = {
  label: string;
  required: boolean;
  covered: boolean;
  terms: string[];
};

export type SourceRelevanceReport = {
  passed: boolean;
  selectedCount: number;
  rejectedCount: number;
  missingRequiredGroups: string[];
  coveredGroups: string[];
  groupCoverage: GroupCoverage[];
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

function newsTopicCovered(source: any, query: string): boolean {
  const plan = buildNewsQueryPlan(query);
  if (!plan.isNewsQuery) return true;

  const topicTerms = plan.topic
    .toLowerCase()
    .split(/\W+/)
    .filter((term) => term.length >= 3);

  const haystack = sourceText(source);
  return topicTerms.length === 0 || topicTerms.some((term) => haystack.includes(term));
}

function scoreNewsSourceForQuery(source: any, query: string): number {
  const plan = buildNewsQueryPlan(query);
  const haystack = sourceText(source);

  const topicTerms = plan.topic
    .toLowerCase()
    .split(/\W+/)
    .filter((term) => term.length >= 3);

  const topicHits = topicTerms.filter((term) => haystack.includes(term)).length;

  const freshnessHits = plan.freshness.queryTerms.filter((term) =>
    haystack.includes(term.toLowerCase()),
  ).length;

  const newsBoost =
    haystack.includes("news") ||
    haystack.includes("reuters") ||
    haystack.includes("apnews") ||
    haystack.includes("associated press") ||
    haystack.includes("theverge") ||
    haystack.includes("techcrunch") ||
    haystack.includes("bbc") ||
    haystack.includes("cnn") ||
    haystack.includes("official")
      ? 2
      : 0;

  return topicHits * 5 + freshnessHits * 2 + newsBoost;
}

export function scoreSourceForQuery(source: any, query: string): number {
  if (isNewsLikeQuery(query)) {
    return scoreNewsSourceForQuery(source, query);
  }
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

function coverageByGroup(sources: any[], groups: AnchorGroup[]): GroupCoverage[] {
  const joined = sources.map(sourceText).join("\n");
  return groups.map((group) => ({
    label: group.label,
    required: group.required,
    covered: groupCovered(joined, group),
    terms: group.terms,
  }));
}

function newsCoverageByGroup(sources: any[], plan: import("./news-query-planner.js").NewsQueryPlan): GroupCoverage[] {
  const topicTerms = plan.topic
    .toLowerCase()
    .split(/\W+/)
    .filter((term) => term.length >= 3);

  const joined = sources.map(sourceText).join("\n");
  const topicCovered = topicTerms.length === 0 || topicTerms.some((term) => joined.includes(term));

  return [
    {
      label: plan.topic || "news topic",
      required: true,
      covered: topicCovered,
      terms: topicTerms,
    },
  ];
}

export function filterAndRankSourcesForQuery(
  sources: any[],
  query: string,
  opts: { topK?: number; minScore?: number } = {},
): { sources: any[]; report: SourceRelevanceReport } {
  if (isNewsLikeQuery(query)) {
    return filterAndRankNewsSources(sources, query, opts);
  }

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

  const groupCoverage = coverageByGroup(selected, groups);

  return {
    sources: selected,
    report: {
      passed: missingRequiredGroups.length === 0,
      selectedCount: selected.length,
      rejectedCount: Math.max(0, sources.length - selected.length),
      missingRequiredGroups,
      coveredGroups,
      groupCoverage,
    },
  };
}

function filterAndRankNewsSources(
  sources: any[],
  query: string,
  opts: { topK?: number; minScore?: number } = {},
): { sources: any[]; report: SourceRelevanceReport } {
  const topK = opts.topK ?? 6;
  const minScore = 3;
  const plan = buildNewsQueryPlan(query);

  const scored = sources
    .map((source) => ({
      source,
      score: scoreSourceForQuery(source, query),
      text: sourceText(source),
    }))
    .sort((a, b) => b.score - a.score);

  const selected = scored
    .filter((item) => item.score >= minScore && newsTopicCovered(item.source, query))
    .slice(0, topK)
    .map((item) => item.source);

  const groupCoverage = newsCoverageByGroup(selected, plan);
  const missingTopic = groupCoverage.filter((g) => g.required && !g.covered);

  return {
    sources: selected,
    report: {
      passed: selected.length > 0 && missingTopic.length === 0,
      selectedCount: selected.length,
      rejectedCount: Math.max(0, sources.length - selected.length),
      missingRequiredGroups: selected.length > 0 ? missingTopic.map((g) => g.label) : [plan.topic || "relevant news"],
      coveredGroups: groupCoverage.filter((g) => g.covered).map((g) => g.label),
      groupCoverage,
    },
  };
}
