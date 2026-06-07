import { prisma } from "@rlm-forge/database/prisma.js";
import { readable, extractUserAnswer } from "../utils/answer-extractor.js";

export async function saveResearchResult(input: {
  projectId: string;
  jobId: string;
  runId: string;
  query: string;
  result: any;
}) {
  const answer = extractUserAnswer(input.result);

  const step = await prisma.agentStep.create({
    data: {
      runId: input.runId,
      stepIndex: 0,
      stdout: readable(input.result),
      result: input.result,
    },
  });

  const report = await prisma.report.create({
    data: {
      projectId: input.projectId,
      jobId: input.jobId,
      title: "RLM Answer",
      content: answer,
      metadata: {
        result: input.result,
        sources: Array.isArray(input.result?.sources) ? input.result.sources : [],
      },
    },
  });

  const researchJob = await prisma.researchJob.findUnique({
    where: { id: input.jobId },
    select: { conversationId: true },
  });

  if (researchJob?.conversationId) {
    await prisma.chatMessage.create({
      data: {
        projectId: input.projectId,
        conversationId: researchJob.conversationId,
        researchJobId: input.jobId,
        role: "assistant",
        content: answer,
        metadata: {
          sources: Array.isArray(input.result?.sources) ? input.result.sources : [],
        },
      },
    });

    await prisma.conversation.update({
      where: { id: researchJob.conversationId },
      data: { updatedAt: new Date() },
    });
  }

  return { step, report, answer };
}
