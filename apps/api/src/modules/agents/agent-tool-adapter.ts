import type { AgentToolName } from "@rlm-forge/knowledge/agent";
import {
  webResearch,
  searchKnowledgeBase,
  githubRepo,
  queryGraph,
} from "../tools/tools.service.js";

export function agentExecutorEnabled(): boolean {
  return process.env.AGENT_EXECUTOR_ENABLED === "true";
}

export function looksLikeAgentExecutorRequest(query: string): boolean {
  const q = query.toLowerCase();
  return (
    q.includes("use agent executor") ||
    q.includes("agent mode") ||
    q.includes("run as agent") ||
    q.includes("agent scaffold")
  );
}

export function getAgentExecutorBudget() {
  return {
    maxSteps: Number(process.env.AGENT_EXECUTOR_MAX_STEPS ?? 5),
    maxToolCalls: Number(process.env.AGENT_EXECUTOR_MAX_TOOL_CALLS ?? 8),
    timeoutMs: Number(process.env.AGENT_EXECUTOR_TIMEOUT_MS ?? 120_000),
  };
}

export async function executeAgentTool(input: {
  tool: AgentToolName;
  stepInput: Record<string, unknown>;
}): Promise<unknown> {
  switch (input.tool) {
    case "search_kb":
      return searchKnowledgeBase({
        projectId: String(input.stepInput.projectId),
        query: String(input.stepInput.query),
      });

    case "web_research":
      return webResearch({
        projectId: String(input.stepInput.projectId),
        userId: input.stepInput.userId ? String(input.stepInput.userId) : undefined,
        query: String(input.stepInput.query),
      });

    case "github_repo":
      return githubRepo({
        projectId: String(input.stepInput.projectId),
        url: String(input.stepInput.url || input.stepInput.query),
      });

    case "query_graph":
      return queryGraph({
        projectId: String(input.stepInput.projectId),
        query: String(input.stepInput.query),
      });

    case "sandbox":
      throw new Error("Sandbox tool execution through AgentExecutor is deferred.");
  }
}
