import type { FastifyInstance } from "fastify";
import { uploadMemorySchema, listMemoriesQuerySchema } from "./memories.schema.js";
import { MemoryManager } from "@rlm-forge/knowledge/memory/memory-manager.js";
import type { ScoutMemoryDraft } from "@rlm-forge/knowledge/memory/memory-types.js";
import { prisma } from "@rlm-forge/database/prisma.js";

const memoryManager = new MemoryManager();

export async function memoriesRouter(app: FastifyInstance) {
  app.post("/memories/upload", async (req) => {
    const input = uploadMemorySchema.parse(req.body);

    const draft: ScoutMemoryDraft = {
      projectId: input.projectId,
      userId: input.userId,
      text: input.text,
      kind: input.kind,
      scope: input.scope,
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
  });

  app.get("/memories", async (req) => {
    const query = listMemoriesQuerySchema.parse(req.query);

    const where: Record<string, unknown> = { projectId: query.projectId };
    if (query.kind) where.kind = query.kind;
    if (query.scope) where.scope = query.scope;

    const [memories, total] = await Promise.all([
      prisma.memory.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: query.limit,
        skip: query.offset,
      }),
      prisma.memory.count({ where }),
    ]);

    return { memories, total };
  });
}
