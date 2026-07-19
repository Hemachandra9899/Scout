import type { FastifyInstance, FastifyReply } from "fastify";
import { Prisma } from "@prisma/client";
import { prisma } from "@rlm-forge/database/prisma.js";
import { chatStreamSchema } from "./chat.schema.js";
import { resolveIntent } from "./intent-resolver.js";
import { answerWithRouter } from "../routing/routing.service.js";
import {
  enqueueResearchJob,
  getResearchJob,
  getResearchJobStatus,
} from "../research-jobs/research-jobs.service.js";

const MODEL_SERVICE_URL =
  process.env.MODEL_SERVICE_URL || "http://model-service:8100";
const RLM_RUNTIME_URL = process.env.RLM_RUNTIME_URL || "http://rlm-runtime:8787";

const DIRECT_PERSONA = [
  "You are Scout, an evidence-first AI research assistant.",
  "Answer greetings and simple questions directly, concisely, and helpfully.",
  "When asked what you can do, briefly describe your abilities: web research with",
  "citations, GitHub repository analysis and code-graph queries, knowledge-base",
  "search over uploaded documents, and persistent memory.",
  "Do not fabricate facts; if a question needs current or external information,",
  "say you can research it.",
].join(" ");

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type SseSend = (event: string, data: Record<string, unknown>) => void;

function makeSend(reply: FastifyReply, isClosed: () => boolean): SseSend {
  return (event, data) => {
    if (isClosed()) return;
    reply.raw.write(`event: ${event}\n`);
    reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
  };
}

function parseSseBlock(block: string): { event: string; data: any } | null {
  let event = "message";
  let dataRaw = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataRaw += line.slice(5).trim();
  }
  if (!dataRaw) return null;
  try {
    return { event, data: JSON.parse(dataRaw) };
  } catch {
    return null;
  }
}

function extractAnswer(result: unknown): string {
  const r = result as any;
  if (typeof r === "string") return r;
  return (
    r?.ui?.answerMarkdown ??
    r?.answer?.markdown ??
    r?.answer ??
    r?.final ??
    ""
  );
}

function extractSources(result: unknown): unknown[] {
  const r = result as any;
  const s = r?.ui?.citations ?? r?.sources ?? r?.answer?.citations ?? [];
  return Array.isArray(s) ? s : [];
}

/** Stream the precomputed answer to the client in small chunks for a typing feel. */
async function streamTextInChunks(text: string, send: SseSend): Promise<void> {
  const parts = text.split(/(\s+)/);
  let buf = "";
  for (const part of parts) {
    buf += part;
    if (buf.length >= 24) {
      send("token", { delta: buf });
      buf = "";
      await sleep(10);
    }
  }
  if (buf) send("token", { delta: buf });
}

/** True token streaming for the direct flow via model-service /chat/stream. */
async function streamDirectAnswer(query: string, send: SseSend): Promise<string> {
  const messages = [
    { role: "system", content: DIRECT_PERSONA },
    { role: "user", content: query },
  ];

  let response: Response;
  try {
    response = await fetch(`${MODEL_SERVICE_URL}/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "reasoning", messages, temperature: 0.3, max_tokens: 1200 }),
    });
  } catch {
    response = new Response(null, { status: 502 });
  }

  if (!response.ok || !response.body) {
    // Fallback to the non-streaming endpoint, then chunk it.
    const fallback = await fetch(`${MODEL_SERVICE_URL}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "reasoning", messages, temperature: 0.3, max_tokens: 1200 }),
    }).catch(() => null);
    const content = String(((await fallback?.json().catch(() => ({}))) as any)?.content ?? "");
    await streamTextInChunks(content, send);
    return content;
  }

  let content = "";
  let buffer = "";
  const decoder = new TextDecoder();

  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const ev = parseSseBlock(block);
        if (!ev) continue;
        if (ev.event === "token" && ev.data?.delta) {
          content += ev.data.delta;
          send("token", { delta: ev.data.delta });
        } else if (ev.event === "thinking" && ev.data?.delta) {
          send("thinking", { delta: ev.data.delta });
        } else if (ev.event === "error") {
          send("error", ev.data);
        }
      }
    }
  } catch {
    // Stream interrupted — keep whatever was already produced.
  }
  return content;
}

/** Run the agent flow via the existing BullMQ research-job pipeline instead of a raw fetch. */
async function runAgentViaJob(
  projectId: string,
  conversationId: string,
  query: string,
  send: SseSend,
  isClosed: () => boolean,
): Promise<{ content: string; sources: unknown[] }> {
  try {
    const job = await enqueueResearchJob(projectId, conversationId, query);
    send("job_created", { jobId: job.id });

    return await new Promise((resolve) => {
      const heartbeat = setInterval(() => {
        if (!isClosed()) send("heartbeat", {});
      }, 15000);

      const poll = async () => {
        if (isClosed()) {
          clearInterval(heartbeat);
          clearInterval(interval);
          resolve({ content: "", sources: [] });
          return;
        }

        const status = await getResearchJobStatus(job.id);
        if (!status) return;

        if (status.status === "QUEUED" || status.status === "RUNNING") {
          send("thinking", { label: "Agent", flow: "agent" });
        } else if (status.status === "COMPLETED") {
          clearInterval(heartbeat);
          clearInterval(interval);
          const full = await getResearchJob(job.id);
          const report = full?.reports?.[0];
          const content = report?.content ?? "";
          const metadata = report?.metadata as Record<string, unknown> | undefined;
          const sources = (metadata?.sources as unknown[]) ?? [];
          await streamTextInChunks(content, send);
          if (sources.length > 0) send("sources", { sources });
          resolve({ content, sources });
        } else if (status.status === "FAILED") {
          clearInterval(heartbeat);
          clearInterval(interval);
          const msg = status.error ?? "Job failed";
          send("error", { error: msg });
          resolve({ content: `I ran into an error: ${msg}`, sources: [] });
        }
      };

      const interval = setInterval(poll, 500);
      poll();
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    send("error", { error: message });
    return { content: `I ran into an error: ${message}`, sources: [] };
  }
}

async function ensureProject(projectId: string) {
  await prisma.project.upsert({
    where: { id: projectId },
    update: {},
    create: {
      id: projectId,
      name: projectId === "default-project" ? "Default Project" : "Chat Project",
      description: "Auto-created for streaming chat.",
    },
  });
}

async function ensureConversation(
  projectId: string,
  conversationId: string | undefined,
  query: string,
) {
  if (conversationId) {
    const existing = await prisma.conversation.findUnique({ where: { id: conversationId } });
    if (existing) return existing;
  }
  return prisma.conversation.create({
    data: { projectId, title: query.slice(0, 80) },
  });
}

export async function chatRouter(app: FastifyInstance) {
  app.post("/chat/stream", async (req, reply) => {
    const input = chatStreamSchema.parse(req.body);
    const query = input.query?.trim();
    if (!query) {
      reply.code(400);
      return { error: "query is required" };
    }

    const projectId = input.projectId ?? "default-project";
    await ensureProject(projectId);
    const conversation = await ensureConversation(projectId, input.conversationId, query);

    await prisma.chatMessage.create({
      data: { conversationId: conversation.id, projectId, role: "user", content: query },
    });

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });

    let closed = false;
    req.raw.on("close", () => {
      closed = true;
    });
    const send = makeSend(reply, () => closed);

    send("conversation", { conversationId: conversation.id });

    let assistantContent = "";
    let sources: unknown[] = [];
    let usedAgentJob = false;

    try {
      const decision = await resolveIntent({
        query,
        mode: input.mode,
        context: input.context,
      });
      send("intent", {
        flow: decision.flow,
        confidence: decision.confidence,
        reason: decision.reason,
        signals: decision.signals,
        escalated: decision.escalated,
      });

      if (decision.flow === "direct") {
        send("thinking", { label: "Thinking" });
        assistantContent = await streamDirectAnswer(decision.normalizedQuery, send);
      } else if (decision.flow === "agent") {
        usedAgentJob = true;
        send("thinking", { label: "Agent", flow: "agent" });
        const agentResult = await runAgentViaJob(
          projectId,
          conversation.id,
          decision.normalizedQuery,
          send,
          () => closed,
        );
        assistantContent = agentResult.content;
        sources = agentResult.sources;
      } else {
        const label =
          decision.flow === "web_research"
            ? "Researching"
            : decision.flow === "github_repo"
              ? "Analyzing repository"
              : decision.flow === "graph_query"
                ? "Querying code graph"
                : "Working";
        send("thinking", { label, flow: decision.flow });

        const result = await answerWithRouter({
          projectId,
          userId: input.userId,
          query: decision.normalizedQuery,
        });

        assistantContent = extractAnswer(result);
        sources = extractSources(result);
        await streamTextInChunks(assistantContent, send);
        if (sources.length > 0) send("sources", { sources });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!assistantContent) assistantContent = `I ran into an error: ${message}`;
      send("error", { error: message });
    }

    if (assistantContent.trim() && !usedAgentJob) {
      await prisma.chatMessage
        .create({
          data: {
            conversationId: conversation.id,
            projectId,
            role: "assistant",
            content: assistantContent,
            metadata:
              sources.length > 0
                ? ({ sources } as unknown as Prisma.InputJsonValue)
                : undefined,
          },
        })
        .catch(() => undefined);
    }

    send("done", {});
    if (!closed) reply.raw.end();
  });
}
