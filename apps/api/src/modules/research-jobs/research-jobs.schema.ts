import { z } from "zod";

export const createResearchJobSchema = z.object({
  projectId: z.string().uuid(),
  conversationId: z.string().uuid().optional(),
  question: z.string().min(1),
});

export const getResearchJobParamsSchema = z.object({
  id: z.string().uuid(),
});

export const listProjectJobsParamsSchema = z.object({
  id: z.string().uuid(),
});

export type CreateResearchJobInput = z.infer<typeof createResearchJobSchema>;
