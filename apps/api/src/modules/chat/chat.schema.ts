import { z } from "zod";

export const chatStreamSchema = z.object({
  projectId: z.string().optional(),
  userId: z.string().optional(),
  query: z.string(),
  mode: z
    .enum(["auto", "web_research", "deep_research", "github_repo", "agent", "kb"])
    .optional(),
  conversationId: z.string().optional(),
  context: z
    .object({
      hasDocument: z.boolean().optional(),
    })
    .optional(),
});

export type ChatStreamInput = z.infer<typeof chatStreamSchema>;
