import type {
  RerankCandidate,
  RerankDebug,
  RerankInput,
  RerankResult,
} from "./reranker-types.js";

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "to",
  "of",
  "in",
  "on",
  "for",
  "with",
  "by",
  "is",
  "are",
  "was",
  "were",
  "what",
  "how",
  "why",
  "when",
  "where",
  "which",
  "this",
  "that",
  "these",
  "those",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_./:-]+/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token));
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function lexicalOverlapScore(query: string, text: string): number {
  const queryTokens = unique(tokenize(query));
  const textTokens = new Set(tokenize(text));

  if (queryTokens.length === 0) return 0;

  const hits = queryTokens.filter((token) => textTokens.has(token)).length;
  const phraseBoost = text.toLowerCase().includes(query.toLowerCase()) ? 0.15 : 0;

  return Math.min(1, hits / queryTokens.length + phraseBoost);
}

function titleBoost(query: string, candidate: RerankCandidate): number {
  if (!candidate.title) return 0;
  return lexicalOverlapScore(query, candidate.title) * 0.15;
}

function sourceQualityBoost(candidate: RerankCandidate): number {
  const url = candidate.url?.toLowerCase() ?? "";
  const sourceType = candidate.sourceType?.toLowerCase() ?? "";

  if (sourceType.includes("official")) return 0.18;
  if (url.includes("docs.") || url.includes("developers.") || url.includes("developer.")) return 0.14;
  if (url.includes("github.com")) return 0.08;
  if (sourceType.includes("community")) return -0.03;

  return 0;
}

function freshnessBoost(candidate: RerankCandidate): number {
  const metadata = candidate.metadata ?? {};
  const publishedAt = metadata.publishedAt ?? metadata.date ?? metadata.updatedAt;

  if (typeof publishedAt !== "string") return 0;

  const time = Date.parse(publishedAt);
  if (!Number.isFinite(time)) return 0;

  const ageDays = (Date.now() - time) / (1000 * 60 * 60 * 24);

  if (ageDays <= 14) return 0.08;
  if (ageDays <= 90) return 0.04;
  if (ageDays > 730) return -0.04;

  return 0;
}

function surfaceBoost(surface: string, candidate: RerankCandidate): number {
  const metadata = candidate.metadata ?? {};

  if (surface === "memory") {
    const kind = String(metadata.kind ?? candidate.sourceType ?? "");
    if (kind === "source_quality") return 0.14;
    if (kind === "source_failure") return -0.2;
    if (kind === "preference") return 0.08;
    if (kind === "durable_fact") return 0.1;
  }

  if (surface === "repo_graph") {
    const type = String(metadata.type ?? "");
    if (type === "file") return 0.08;
    if (type === "symbol") return 0.06;
    if (type === "service") return 0.05;
  }

  return 0;
}

export function deterministicRerank(input: RerankInput): {
  results: RerankResult[];
  debug: RerankDebug;
} {
  const topK = input.topK ?? Math.min(12, input.candidates.length);

  const results = input.candidates
    .map((candidate) => {
      const lexicalScore = lexicalOverlapScore(
        input.query,
        [
          candidate.title ?? "",
          candidate.text,
          candidate.url ?? "",
        ].join("\n"),
      );

      const baseScore = candidate.baseScore ?? 0;
      const sourceScore = sourceQualityBoost(candidate);
      const finalScore =
        lexicalScore * 0.55 +
        Math.min(1, Math.max(0, baseScore)) * 0.2 +
        titleBoost(input.query, candidate) +
        sourceScore +
        freshnessBoost(candidate) +
        surfaceBoost(input.surface, candidate);

      const boundedFinalScore = Math.max(0, Math.min(1, finalScore));

      return {
        ...candidate,
        lexicalScore,
        sourceScore,
        rerankScore: lexicalScore,
        finalScore: boundedFinalScore,
        reason: [
          `lexical=${lexicalScore.toFixed(2)}`,
          `base=${baseScore.toFixed(2)}`,
          sourceScore ? `source=${sourceScore.toFixed(2)}` : "",
          `surface=${input.surface}`,
        ]
          .filter(Boolean)
          .join(", "),
      };
    })
    .sort((a, b) => {
      if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
      return a.id.localeCompare(b.id);
    })
    .slice(0, topK);

  return {
    results,
    debug: {
      rerankerUsed: true,
      rerankerKind: "deterministic",
      surface: input.surface,
      inputCount: input.candidates.length,
      outputCount: results.length,
      topK,
      reasons: results.slice(0, 10).map((result) => ({
        id: result.id,
        finalScore: result.finalScore,
        lexicalScore: result.lexicalScore,
        reason: result.reason,
      })),
    },
  };
}
