import { z } from "zod";

export const uploadMemorySchema = z.object({
  projectId: z.string().uuid(),
  userId: z.string().optional(),
  text: z.string().min(1).max(10000),
  kind: z.enum(["preference", "fact", "durable_fact", "source_quality", "source_failure", "decision", "task_trace"]).optional().default("fact"),
  scope: z.enum(["user", "project", "session", "agent", "source"]).optional().default("user"),
  sourceUrls: z.array(z.string().url()).optional(),
  confidence: z.number().min(0).max(1).optional(),
  entities: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const listMemoriesQuerySchema = z.object({
  projectId: z.string().uuid(),
  userId: z.string().optional(),
  kind: z.string().optional(),
  scope: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});
