import type { FastifyInstance } from "fastify";
import { uploadMemorySchema, listMemoriesQuerySchema } from "./memories.schema.js";
import { uploadMemory, listMemories } from "./memories.service.js";

export async function memoriesRouter(app: FastifyInstance) {
  app.post("/memories/upload", async (req) => {
    const input = uploadMemorySchema.parse(req.body);
    return uploadMemory(input);
  });

  app.get("/memories", async (req) => {
    const query = listMemoriesQuerySchema.parse(req.query);
    return listMemories(query);
  });
}
