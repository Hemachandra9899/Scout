import { prisma } from "@rlm-forge/database/prisma.js";

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "this",
  "that",
  "into",
  "about",
  "using",
  "uploaded",
  "document",
  "file",
  "answer",
  "sources",
  "source",
  "summarize",
  "summary",
  "key",
  "points",
  "please",
  "what",
  "does",
  "tell",
  "give",
  "show",
]);

export function preview(text: string, maxChars = 1200): string {
  if (!text) return "";
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n...[truncated ${text.length - maxChars} chars]`;
}

function extractQuotedPhrases(query: string): string[] {
  const matches = [...query.matchAll(/"([^"]+)"/g)];
  return matches
    .map((match) => match[1]?.trim())
    .filter(Boolean);
}

function tokenize(query: string): string[] {
  const quoted = extractQuotedPhrases(query);

  const tokens = query
    .toLowerCase()
    .replace(/["'`]/g, " ")
    .replace(/[^a-z0-9.+#\s-]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => token.length >= 2)
    .filter((token) => !STOPWORDS.has(token));

  const quotedTokens = quoted.flatMap((phrase) =>
    phrase
      .toLowerCase()
      .replace(/[^a-z0-9.+#\s-]/g, " ")
      .split(/\s+/)
      .map((token) => token.trim())
      .filter(Boolean)
      .filter((token) => token.length >= 2)
  );

  return [...new Set([...quotedTokens, ...tokens])].slice(0, 12);
}

function scoreChunk(input: {
  query: string;
  tokens: string[];
  chunkText: string;
  title?: string | null;
  sourceUrl?: string | null;
}) {
  const chunk = input.chunkText.toLowerCase();
  const title = (input.title || "").toLowerCase();
  const sourceUrl = (input.sourceUrl || "").toLowerCase();

  let score = 0;

  for (const token of input.tokens) {
    if (title.includes(token)) score += 8;
    if (sourceUrl.includes(token)) score += 4;
    if (chunk.includes(token)) score += 2;
  }

  for (const phrase of extractQuotedPhrases(input.query)) {
    const p = phrase.toLowerCase();
    if (title.includes(p)) score += 25;
    if (sourceUrl.includes(p)) score += 10;
    if (chunk.includes(p)) score += 8;
  }

  return score;
}

export async function keywordSearchChunks(input: {
  projectId?: string;
  query: string;
  topK?: number;
}) {
  const topK = input.topK ?? 5;
  const tokens = tokenize(input.query);

  if (tokens.length === 0) {
    return [];
  }

  const chunks = await prisma.chunk.findMany({
    where: {
      ...(input.projectId
        ? {
            document: {
              projectId: input.projectId,
            },
          }
        : {}),
      OR: tokens.flatMap((token) => [
        {
          chunkText: {
            contains: token,
            mode: "insensitive" as const,
          },
        },
        {
          document: {
            title: {
              contains: token,
              mode: "insensitive" as const,
            },
          },
        },
        {
          document: {
            sourceUrl: {
              contains: token,
              mode: "insensitive" as const,
            },
          },
        },
      ]),
    },
    include: {
      document: true,
    },
    orderBy: {
      createdAt: "desc",
    },
    take: Math.max(topK * 8, 40),
  });

  return chunks
    .map((chunk) => {
      const score = scoreChunk({
        query: input.query,
        tokens,
        chunkText: chunk.chunkText,
        title: chunk.document.title,
        sourceUrl: chunk.document.sourceUrl,
      });

      return {
        chunk,
        score,
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(({ chunk, score }) => ({
      chunkId: chunk.id,
      documentId: chunk.documentId,
      chunkIndex: chunk.chunkIndex,
      title: chunk.document.title,
      sourceUrl: chunk.document.sourceUrl,
      text: preview(chunk.chunkText, 1800),
      score,
      retrieval: "keyword",
      metadata: chunk.metadata,
    }));
}
