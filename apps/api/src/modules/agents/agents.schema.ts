import { z } from "zod";

export const createAgentRunSchema = z.object({
  projectId: z.string().min(1),
  userId: z.string().optional(),
  query: z.string().min(1),
});

export const agentRunParamsSchema = z.object({
  runId: z.string().min(1),
});
