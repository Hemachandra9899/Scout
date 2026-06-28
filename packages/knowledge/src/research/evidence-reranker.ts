import type { EvidenceItem } from "./source-types.js";
import { getEvidenceReranker, scoreEvidenceRelevance } from "./reranker.js";

/**
 * Back-compatible wrappers around the pluggable reranker (see reranker.ts).
 * Existing callers keep using these; the underlying scorer is now the stronger
 * deterministic reranker and can be swapped for a model-backed one via env.
 */
export function scoreEvidenceForQuery(item: EvidenceItem, query: string): number {
  return scoreEvidenceRelevance(item, query).score;
}

export function rerankEvidenceForQuery<T extends EvidenceItem>(
  evidence: T[],
  query: string,
  topK = 8,
): T[] {
  return getEvidenceReranker().rerank(query, evidence, topK);
}
