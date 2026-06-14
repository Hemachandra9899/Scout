import type { EvidenceItem } from "./source-types.js";

function terms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\W+/)
    .filter((term) => term.length >= 4);
}

function textOfEvidence(item: EvidenceItem): string {
  return [
    item.claim,
    item.quote,
    item.text,
    item.title,
    item.url,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function scoreEvidenceForQuery(item: EvidenceItem, query: string): number {
  const haystack = textOfEvidence(item);
  const queryTerms = terms(query);

  const termHits = queryTerms.filter((term) =>
    haystack.includes(term),
  ).length;

  const officialBoost =
    item.tier === "official_docs" || item.tier === "trusted_docs" ? 2 : 0;

  const confidenceBoost = Number(item.confidence ?? 0);

  const quoteBoost = item.quote || item.text ? 0.5 : 0;

  return termHits + officialBoost + confidenceBoost + quoteBoost;
}

export function rerankEvidenceForQuery<T extends EvidenceItem>(
  evidence: T[],
  query: string,
  topK = 8,
): T[] {
  return [...evidence]
    .map((item) => ({
      item,
      score: scoreEvidenceForQuery(item, query),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(({ item }) => item);
}
