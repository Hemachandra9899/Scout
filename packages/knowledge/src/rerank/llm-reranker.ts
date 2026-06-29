import type {
  RerankCandidate,
  RerankInput,
  RerankResult,
} from "./reranker-types.js";
import { deterministicRerank } from "./deterministic-reranker.js";

export type LlmReranker = (input: {
  query: string;
  surface: string;
  candidates: Array<{
    id: string;
    title?: string | null;
    textPreview: string;
  }>;
  timeoutMs: number;
}) => Promise<string>;

function parseLlmRerankJson(input: string): Array<{ id: string; score: number; reason?: string }> | null {
  try {
    const parsed = JSON.parse(input);

    if (!Array.isArray(parsed)) return null;

    return parsed
      .map((item) => ({
        id: String(item.id),
        score: Math.max(0, Math.min(1, Number(item.score))),
        reason: typeof item.reason === "string" ? item.reason.slice(0, 160) : undefined,
      }))
      .filter((item) => item.id && Number.isFinite(item.score));
  } catch {
    return null;
  }
}

export async function rerankWithOptionalLlm(input: RerankInput & {
  llm?: LlmReranker;
}) {
  const deterministic = deterministicRerank(input);

  if (process.env.RERANKER_LLM_ENABLED !== "true") {
    return deterministic;
  }

  if (!input.llm) {
    return {
      ...deterministic,
      debug: {
        ...deterministic.debug,
        rerankerKind: "fallback" as const,
      },
    };
  }

  const timeoutMs = Number(process.env.RERANKER_LLM_TIMEOUT_MS ?? 5000);
  const candidatePreview = deterministic.results.slice(0, 20).map((candidate) => ({
    id: candidate.id,
    title: candidate.title,
    textPreview: candidate.text.slice(0, 600),
  }));

  try {
    const output = await Promise.race([
      input.llm({
        query: input.query,
        surface: input.surface,
        candidates: candidatePreview,
        timeoutMs,
      }),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error("LLM reranker timed out")), timeoutMs),
      ),
    ]);

    const parsed = parseLlmRerankJson(output);
    if (!parsed?.length) return deterministic;

    const scoreById = new Map(parsed.map((item) => [item.id, item]));
    const byId = new Map(deterministic.results.map((item) => [item.id, item]));

    const reranked = parsed
      .map((item) => {
        const original = byId.get(item.id);
        if (!original) return null;

        return {
          ...original,
          semanticScore: item.score,
          finalScore: Math.max(0, Math.min(1, original.finalScore * 0.45 + item.score * 0.55)),
          reason: item.reason ?? `LLM reranked; deterministic=${original.finalScore.toFixed(2)}`,
        } as RerankResult;
      })
      .filter((x): x is RerankResult => x !== null)
      .sort((a, b) => b.finalScore - a.finalScore);

    const untouched = deterministic.results.filter((item) => !scoreById.has(item.id)) as RerankResult[];
    const results = [...reranked, ...untouched].slice(0, input.topK ?? deterministic.results.length);

    return {
      results,
      debug: {
        ...deterministic.debug,
        rerankerKind: "llm" as const,
        outputCount: results.length,
        reasons: results.slice(0, 10).map((result) => ({
          id: result.id,
          finalScore: result.finalScore,
          lexicalScore: result.lexicalScore,
          reason: result.reason,
        })),
      },
    };
  } catch {
    return {
      ...deterministic,
      debug: {
        ...deterministic.debug,
        rerankerKind: "fallback" as const,
      },
    };
  }
}
