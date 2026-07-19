import {
  buildDeterministicAgentPlan,
  executeAgentPlan,
} from "@rlm-forge/knowledge/agent";
import {
  updateAgentRun,
  appendAgentRunEvent,
  type AgentRunRecord,
} from "./agent-runs.store.js";
import {
  agentExecutorEnabled,
  getAgentExecutorBudget,
  executeAgentTool,
} from "./agent-tool-adapter.js";

export async function executeAgentRun(run: AgentRunRecord) {
  if (!agentExecutorEnabled()) return;

  updateAgentRun(run.id, { status: "running" });

  try {
    const plan = buildDeterministicAgentPlan({
      objective: run.query,
      projectId: run.projectId,
      userId: run.userId,
    });

    const result = await executeAgentPlan({
      plan,
      budget: getAgentExecutorBudget(),
      onEvent: (event) => {
        appendAgentRunEvent(run.id, event);
      },
      executeTool: async (tool, stepInput) => {
        return executeAgentTool({ tool, stepInput });
      },
    });

    updateAgentRun(run.id, {
      status: result.status === "completed" ? "completed" : "failed",
      result,
    });
  } catch (error) {
    updateAgentRun(run.id, {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
