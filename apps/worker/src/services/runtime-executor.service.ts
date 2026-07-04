import { prisma, buildConversationContext } from "@rlm-forge/database";

const runtimeUrl = process.env.RLM_RUNTIME_URL || "http://rlm-runtime:8787";

export async function executeResearchQuery(input: {
  runId: string;
  projectId: string;
  query: string;
  conversationId?: string;
}) {
  let conversationContext: Array<{ role: string; content: string }> | undefined;
  let contextTruncated: boolean | undefined;

  if (input.conversationId) {
    const conversationMessages = await prisma.chatMessage.findMany({
      where: { conversationId: input.conversationId },
      orderBy: { createdAt: "asc" },
      select: { role: true, content: true },
    });

    const context = buildConversationContext(conversationMessages);
    conversationContext = context.messages;
    contextTruncated = context.truncated;
  }

  const resp = await fetch(`${runtimeUrl}/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      runId: input.runId,
      projectId: input.projectId,
      query: input.query,
      maxSteps: 5,
      maxDepth: 2,
      conversationContext,
      contextTruncated,
    }),
  });

  return await resp.json();
}
