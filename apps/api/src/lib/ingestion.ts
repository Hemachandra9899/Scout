import { createHash } from "node:crypto";
import { prisma } from "../db.js";
import { chunkText, preview } from "./text.js";

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export async function ingestMarkdownDocument(input: {
  projectId: string;
  sourceUrl?: string;
  title?: string;
  markdown: string;
  metadata?: Record<string, unknown>;
}) {
  const contentHash = hashText(input.markdown);
  const chunks = chunkText(input.markdown);

  const existing = await prisma.document.findFirst({
    where: {
      projectId: input.projectId,
      contentHash,
    },
    include: {
      chunks: true,
    },
  });

  if (existing && existing.chunks.length > 0) {
    return {
      document: existing,
      chunksCreated: 0,
      chunksTotal: existing.chunks.length,
      deduped: true,
    };
  }

  const document =
    existing ||
    (await prisma.document.create({
      data: {
        projectId: input.projectId,
        sourceUrl: input.sourceUrl,
        title: input.title || input.sourceUrl || "Untitled document",
        markdown: input.markdown,
        contentHash,
        metadata: (input.metadata || {}) as any,
      },
    }));

  if (existing && existing.chunks.length === 0) {
    await prisma.chunk.deleteMany({
      where: {
        documentId: existing.id,
      },
    });
  }

  if (chunks.length > 0) {
    await prisma.chunk.createMany({
      data: chunks.map((chunk) => ({
        documentId: document.id,
        chunkIndex: chunk.index,
        chunkText: chunk.text,
        metadata: {
          startChar: chunk.startChar,
          endChar: chunk.endChar,
          preview: preview(chunk.text, 240),
        },
      })),
    });
  }

  return {
    document,
    chunksCreated: chunks.length,
    chunksTotal: chunks.length,
    deduped: false,
  };
}

export async function searchChunks(input: {
  projectId?: string;
  query: string;
  topK?: number;
}) {
  const topK = input.topK ?? 5;

  const chunks = await prisma.chunk.findMany({
    where: {
      chunkText: {
        contains: input.query,
        mode: "insensitive",
      },
      ...(input.projectId
        ? {
            document: {
              projectId: input.projectId,
            },
          }
        : {}),
    },
    include: {
      document: true,
    },
    orderBy: {
      createdAt: "desc",
    },
    take: topK,
  });

  return chunks.map((chunk) => ({
    chunkId: chunk.id,
    documentId: chunk.documentId,
    chunkIndex: chunk.chunkIndex,
    title: chunk.document.title,
    sourceUrl: chunk.document.sourceUrl,
    text: preview(chunk.chunkText, 1400),
    metadata: chunk.metadata,
  }));
}
