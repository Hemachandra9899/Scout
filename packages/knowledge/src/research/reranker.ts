import type { EvidenceItem, SourceTier } from "./source-types.js";

/**
 * Pluggable evidence reranking. The default is a deterministic lexical+structural
 * scorer (no external dependency). A model/cross-encoder reranker can be registered
 * in getEvidenceReranker() later behind RERANKER_PROVIDER, without touching callers.
 */
export type RerankSignals = {
  termHits: number;
  termCoverage: number;
  titleHits: number;
  entityHits: number;
  tierBoost: number;
  confidence: number;
  quoteBoost: number;
  fallbackPenalty: number;
};

export interface EvidenceReranker {
  readonly name: string;
  rerank<T extends EvidenceItem>(query: string, items: T[], topK: number): T[];
}

function queryTerms(query: string): string[] {
  return [
    ...new Set(
      query
        .toLowerCase()
        .split(/\W+/)
        .filter((term) => term.length >= 4),
    ),
  ];
}

function tierBoost(tier: SourceTier): number {
  if (tier === "official_docs" || tier === "trusted_docs") return 2;
  if (tier === "reference_examples") return 1;
  return 0;
}

/** Score one evidence item against the query. Higher is more relevant. */
export function scoreEvidenceRelevance(
  item: EvidenceItem,
  query: string,
): { score: number; signals: RerankSignals } {
  const terms = queryTerms(query);
  const haystack = [item.claim, item.quote, item.text, item.title, item.url]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const title = (item.title ?? "").toLowerCase();
  const entities = (item.entities ?? []).map((e) => String(e).toLowerCase());

  const termHits = terms.filter((t) => haystack.includes(t)).length;
  const termCoverage = terms.length > 0 ? termHits / terms.length : 0;
  const titleHits = terms.filter((t) => title.includes(t)).length;
  const entityHits = terms.filter((t) => entities.some((e) => e.includes(t))).length;
  const tb = tierBoost(item.tier);
  const confidence = Number(item.confidence ?? 0);
  const quoteBoost = item.quote || item.text ? 0.5 : 0;
  const fallbackPenalty = (item.metadata as { fallbackEvidence?: boolean } | undefined)
    ?.fallbackEvidence
    ? 1
    : 0;

  const score =
    termHits +
    termCoverage * 2 +
    titleHits * 0.5 +
    entityHits * 0.5 +
    tb +
    confidence +
    quoteBoost -
    fallbackPenalty;

  return {
    score,
    signals: {
      termHits,
      termCoverage,
      titleHits,
      entityHits,
      tierBoost: tb,
      confidence,
      quoteBoost,
      fallbackPenalty,
    },
  };
}

export class DeterministicEvidenceReranker implements EvidenceReranker {
  readonly name = "deterministic";

  rerank<T extends EvidenceItem>(query: string, items: T[], topK: number): T[] {
    return [...items]
      .map((item) => ({ item, score: scoreEvidenceRelevance(item, query).score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(0, topK))
      .map(({ item }) => item);
  }
}

let cachedReranker: EvidenceReranker | null = null;

/**
 * Returns the active reranker. Deterministic by default; a model-backed reranker can
 * be selected via RERANKER_PROVIDER once implemented (it must satisfy EvidenceReranker).
 */
export function getEvidenceReranker(): EvidenceReranker {
  if (cachedReranker) return cachedReranker;

  const provider = (process.env.RERANKER_PROVIDER ?? "deterministic").toLowerCase();
  switch (provider) {
    // case "cross_encoder": cachedReranker = new CrossEncoderReranker(); break;
    default:
      cachedReranker = new DeterministicEvidenceReranker();
  }

  return cachedReranker;
}
