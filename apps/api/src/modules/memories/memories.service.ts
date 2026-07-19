import { MemoryManager } from "@rlm-forge/knowledge/memory/memory-manager.js";
import type { ScoutMemoryDraft } from "@rlm-forge/knowledge/memory/memory-types.js";
import { prisma } from "@rlm-forge/database/prisma.js";

const memoryManager = new MemoryManager();

export async function uploadMemory(input: {
  projectId: string;
  userId?: string;
  text: string;
  kind?: string;
  scope?: string;
  sourceUrls?: string[];
  confidence?: number;
  entities?: string[];
  metadata?: Record<string, unknown>;
}) {
  const draft: ScoutMemoryDraft = {
    projectId: input.projectId,
    userId: input.userId,
    text: input.text,
    kind: input.kind as any,
    scope: input.scope as any,
    sourceUrls: input.sourceUrls,
    confidence: input.confidence,
    entities: input.entities,
    metadata: {
      ...(input.metadata ?? {}),
      source: "user-upload",
    },
  };

  const written = await memoryManager.addMany([draft]);
  return { written };
}

export async function listMemories(input: {
  projectId: string;
  kind?: string;
  scope?: string;
  limit: number;
  offset: number;
}) {
  const where: Record<string, unknown> = { projectId: input.projectId };
  if (input.kind) where.kind = input.kind;
  if (input.scope) where.scope = input.scope;

  const [memories, total] = await Promise.all([
    prisma.memory.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: input.limit,
      skip: input.offset,
    }),
    prisma.memory.count({ where }),
  ]);

  return { memories, total };
}
