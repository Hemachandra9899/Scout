import { prisma } from "@rlm-forge/database/prisma.js";

const runtimeUrl = process.env.RLM_RUNTIME_URL || "http://rlm-runtime:8787";
const DEFAULT_MAX_CONTEXT_CHARS = Number(
  process.env.MAX_CHAT_CONTEXT_CHARS || 24_000,
);

function buildConversationContext(
  messages: Array<{ role: string; content: string }>,
  maxChars = DEFAULT_MAX_CONTEXT_CHARS,
) {
  const selected: Array<{ role: string; content: string }> = [];
  let total = 0;

  for (const message of [...messages].reverse()) {
    const cost = message.content.length + message.role.length + 20;

    if (total + cost > maxChars) break;

    selected.unshift(message);
    total += cost;
  }

  return {
    messages: selected,
    usedChars: total,
    truncated: selected.length < messages.length,
  };
}

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
