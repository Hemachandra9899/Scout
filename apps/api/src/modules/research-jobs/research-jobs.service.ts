import { prisma } from "@rlm-forge/database/prisma.js";
import { createResearchQueue } from "@rlm-forge/queue";
import type { CreateResearchJobInput } from "./research-jobs.schema.js";

export function listProjectJobs(projectId: string) {
  return prisma.researchJob.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    include: {
      reports: true,
      agentRuns: {
        include: { steps: true },
      },
    },
  });
}

export async function createResearchJob(input: CreateResearchJobInput) {
  const conversation = input.conversationId
    ? await prisma.conversation.findUnique({
        where: { id: input.conversationId },
      })
    : await prisma.conversation.create({
        data: {
          projectId: input.projectId,
          title: input.question.slice(0, 80),
        },
      });

  if (!conversation) {
    throw new Error("Conversation not found");
  }

  const job = await prisma.researchJob.create({
    data: {
      projectId: input.projectId,
      conversationId: conversation.id,
      question: input.question,
      status: "QUEUED",
    },
  });

  await prisma.chatMessage.create({
    data: {
      projectId: input.projectId,
      conversationId: conversation.id,
      researchJobId: job.id,
      role: "user",
      content: input.question,
    },
  });

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      updatedAt: new Date(),
      title: conversation.title || input.question.slice(0, 80),
    },
  });

  const queue = createResearchQueue();
  await queue.add("run-research", {
    researchJobId: job.id,
  });

  return {
    jobId: job.id,
    conversationId: conversation.id,
    status: job.status,
  };
}

export function getResearchJob(id: string) {
  return prisma.researchJob.findUnique({
    where: { id },
    include: {
      reports: true,
      agentRuns: {
        include: { steps: true },
      },
    },
  });
}

export function getResearchJobStatus(id: string) {
  return prisma.researchJob.findUnique({
    where: { id },
    select: { id: true, status: true, error: true, updatedAt: true },
  });
}
