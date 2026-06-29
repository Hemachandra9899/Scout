import type { FastifyInstance } from "fastify";
import { uploadMemorySchema } from "./memories.schema.js";
import { MemoryManager } from "@rlm-forge/knowledge/memory/memory-manager.js";
import type { ScoutMemoryDraft } from "@rlm-forge/knowledge/memory/memory-types.js";

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
}
