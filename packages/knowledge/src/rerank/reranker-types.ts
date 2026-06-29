export type RerankSurface =
  | "evidence"
  | "memory"
  | "repo_graph"
  | "kb"
  | "source";

export type RerankCandidate = {
  id: string;
  title?: string | null;
  text: string;
  url?: string | null;
  sourceType?: string | null;
  metadata?: Record<string, unknown>;
  baseScore?: number;
};

export type RerankResult = RerankCandidate & {
  rerankScore: number;
  lexicalScore: number;
  semanticScore?: number;
  sourceScore?: number;
  finalScore: number;
  reason: string;
};

export type RerankInput = {
  query: string;
  candidates: RerankCandidate[];
  surface: RerankSurface;
  topK?: number;
};

export type RerankDebug = {
  rerankerUsed: boolean;
  rerankerKind: "deterministic" | "llm" | "fallback";
  surface: RerankSurface;
  inputCount: number;
  outputCount: number;
  topK: number;
  reasons: Array<{
    id: string;
    finalScore: number;
    lexicalScore: number;
    reason: string;
  }>;
};
