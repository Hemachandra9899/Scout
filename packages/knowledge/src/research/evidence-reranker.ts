import type { EvidenceItem } from "./source-types.js";
import { deterministicRerank } from "../rerank/deterministic-reranker.js";
import type { RerankDebug } from "../rerank/reranker-types.js";

const RERANKER_ENABLED = process.env.RERANKER_ENABLED !== "false";

/**
 * Back-compatible wrappers around the pluggable reranker.
 */
export function scoreEvidenceForQuery(item: EvidenceItem, query: string): number {
  const candidates = [evidenceItemToCandidate(item, 0)];
  const { results } = deterministicRerank({
    query,
    candidates,
    surface: "evidence",
    topK: 1,
  });
  return results[0]?.finalScore ?? 0;
}

function evidenceItemToCandidate(item: EvidenceItem, index: number) {
  return {
    id: item.url || `evidence-${index}`,
    title: item.title,
    text: [
      item.claim,
      item.quote,
      item.text || "",
    ].filter(Boolean).join("\n"),
    url: item.url,
    sourceType: item.tier,
    baseScore: item.confidence ?? 0,
    metadata: {
      originalIndex: index,
      tier: item.tier,
      product: item.product,
      domain: item.domain,
      entities: item.entities,
    },
  };
}

export function rerankEvidenceForQuery<T extends EvidenceItem>(
  evidence: T[],
  query: string,
  topK = 8,
): T[] {
  if (!RERANKER_ENABLED || evidence.length === 0) {
    return evidence.slice(0, topK);
  }

  const candidates = evidence.map((item, index) => evidenceItemToCandidate(item, index));

  const { results } = deterministicRerank({
    query,
    candidates,
    surface: "evidence",
    topK,
  });

  return results
    .map((result) => {
      const origIndex = result.metadata?.originalIndex;
      if (typeof origIndex === "number" && evidence[origIndex]) {
        return {
          ...evidence[origIndex],
          // Keep score/relevance debug metadata if needed
          score: result.finalScore,
        } as T;
      }
      return null;
    })
    .filter((x): x is T => x !== null);
}
