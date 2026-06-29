export type NewsFreshness = {
  kind: "latest" | "today" | "this_week" | "this_month" | "explicit_date" | "none";
  label: string;
  queryTerms: string[];
};

export type NewsQueryPlan = {
  isNewsQuery: boolean;
  topic: string;
  freshness: NewsFreshness;
  queries: string[];
};

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function isNewsLikeQuery(query: string): boolean {
  const q = query.toLowerCase();
  return (
    q.includes("news") ||
    q.includes("latest") ||
    q.includes("recent") ||
    q.includes("current") ||
    q.includes("today") ||
    q.includes("this week") ||
    q.includes("this month") ||
    q.includes("update") ||
    q.includes("updates")
  );
}

export function extractNewsTopic(query: string): string {
  let topic = query.replace(/\bwhat is\b/gi, "");
  topic = topic.replace(/\bwhat are\b/gi, "");
  topic = topic.replace(/\bthe\b/gi, "");
  topic = topic.replace(/\blatest\b/gi, "");
  topic = topic.replace(/\brecent\b/gi, "");
  topic = topic.replace(/\bcurrent\b/gi, "");
  topic = topic.replace(/\bimportant\b/gi, "");
  topic = topic.replace(/\bnews\b/gi, "");
  topic = topic.replace(/\bupdates?\b/gi, "");
  topic = topic.replace(/\btoday\b/gi, "");
  topic = topic.replace(/\bthis week\b/gi, "");
  topic = topic.replace(/\bthis month\b/gi, "");
  topic = topic.replace(/[?!.]/g, " ");
  topic = topic.replace(/\s+/g, " ").trim();
  return topic || query;
}

export function extractNewsFreshness(query: string): NewsFreshness {
  const q = query.toLowerCase();

  const explicitDate =
    query.match(/\b\d{4}-\d{2}-\d{2}\b/) ??
    query.match(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{4}\b/i) ??
    query.match(/\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{4}\b/i);

  if (explicitDate?.[0]) {
    return {
      kind: "explicit_date",
      label: explicitDate[0],
      queryTerms: [explicitDate[0]],
    };
  }

  if (q.includes("today")) {
    return { kind: "today", label: "today", queryTerms: ["today"] };
  }

  if (q.includes("this week")) {
    return { kind: "this_week", label: "this week", queryTerms: ["this week", "latest"] };
  }

  if (q.includes("this month")) {
    return { kind: "this_month", label: "this month", queryTerms: ["this month", "latest"] };
  }

  if (q.includes("latest") || q.includes("recent") || q.includes("current")) {
    return { kind: "latest", label: "latest", queryTerms: ["latest", "recent"] };
  }

  return { kind: "none", label: "", queryTerms: [] };
}

export function buildNewsQueryPlan(query: string): NewsQueryPlan {
  const newsLike = isNewsLikeQuery(query);
  const topic = extractNewsTopic(query);
  const freshness = extractNewsFreshness(query);

  if (!newsLike) {
    return { isNewsQuery: false, topic, freshness, queries: [query] };
  }

  const freshnessTerms = freshness.queryTerms.length > 0 ? freshness.queryTerms : ["latest"];

  const queries = unique([
    query,
    `${topic} ${freshnessTerms[0]} news`,
    `${topic} ${freshnessTerms[0]} updates`,
    `${topic} recent news`,
    `${topic} official update`,
    `${topic} news announcement`,
  ]);

  return {
    isNewsQuery: true,
    topic,
    freshness,
    queries: queries.slice(0, 6),
  };
}
