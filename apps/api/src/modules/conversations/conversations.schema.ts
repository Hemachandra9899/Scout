import { z } from "zod";

export const createConversationSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().optional(),
});

export const conversationParamsSchema = z.object({
  id: z.string().uuid(),
});

export const listConversationParamsSchema = z.object({
  projectId: z.string().uuid(),
});

export type CreateConversationInput = z.infer<typeof createConversationSchema>;
