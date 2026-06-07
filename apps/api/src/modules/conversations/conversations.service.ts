import { prisma } from "@rlm-forge/database/prisma.js";
import type { CreateConversationInput } from "./conversations.schema.js";

export async function createConversation(input: CreateConversationInput) {
  return prisma.conversation.create({
    data: {
      projectId: input.projectId,
      title: input.title || "New Chat",
    },
  });
}

export async function listProjectConversations(projectId: string) {
  return prisma.conversation.findMany({
    where: { projectId },
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { messages: true } },
    },
  });
}

export async function getConversation(id: string) {
  return prisma.conversation.findUnique({
    where: { id },
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
      },
    },
  });
}
