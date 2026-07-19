import type { FastifyInstance } from "fastify";
import {
  agentRunParamsSchema,
  createAgentRunSchema,
} from "./agents.schema.js";
import {
  createAgentRun,
  getAgentRun,
} from "./agent-runs.store.js";
import {
  agentExecutorEnabled,
} from "./agent-tool-adapter.js";
import { executeAgentRun } from "./agents.service.js";

export async function agentsRouter(app: FastifyInstance) {
  app.post("/agents/runs", async (req, reply) => {
    if (!agentExecutorEnabled()) {
      reply.code(403);
      return {
        error: "Agent executor is disabled.",
      };
    }

    const body = createAgentRunSchema.parse(req.body);

    const run = createAgentRun({
      projectId: body.projectId,
      userId: body.userId,
      query: body.query,
    });

    queueMicrotask(() => executeAgentRun(run));

    return {
      status: "accepted",
      runId: run.id,
      events: `/agents/runs/${run.id}/events`,
      result: `/agents/runs/${run.id}`,
    };
  });

  app.get("/agents/runs/:runId", async (req, reply) => {
    const params = agentRunParamsSchema.parse(req.params);
    const run = getAgentRun(params.runId);

    if (!run) {
      reply.code(404);
      return {
        error: "Agent run not found.",
      };
    }

    return {
      status: "ok",
      run,
    };
  });

  app.get("/agents/runs/:runId/events", async (req, reply) => {
    const params = agentRunParamsSchema.parse(req.params);
    const run = getAgentRun(params.runId);

    if (!run) {
      reply.code(404);
      return {
        error: "Agent run not found.",
      };
    }

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });

    let cursor = 0;

    const send = () => {
      const current = getAgentRun(params.runId);
      if (!current) return;

      while (cursor < current.events.length) {
        const event = current.events[cursor];
        reply.raw.write(`event: ${event.type}\n`);
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
        cursor += 1;
      }

      if (current.status === "completed" || current.status === "failed") {
        reply.raw.write(`event: run_${current.status}\n`);
        reply.raw.write(`data: ${JSON.stringify({ status: current.status })}\n\n`);
        clearInterval(interval);
        reply.raw.end();
      }
    };

    const interval = setInterval(send, 500);

    req.raw.on("close", () => {
      clearInterval(interval);
    });

    send();
  });
}
