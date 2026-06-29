import type {
  AgentPlan,
  AgentStep,
  AgentToolName,
} from "./agent-types.js";

function createStep(input: {
  index: number;
  tool: AgentToolName;
  reason: string;
  stepInput: Record<string, unknown>;
}): AgentStep {
  return {
    id: `step-${input.index}`,
    tool: input.tool,
    input: input.stepInput,
    reason: input.reason,
  };
}

export function buildDeterministicAgentPlan(input: {
  objective: string;
  projectId: string;
  userId?: string;
}): AgentPlan {
  const q = input.objective.toLowerCase();
  const steps: AgentStep[] = [];

  if (
    q.includes("repo") &&
    (q.includes("graph") || q.includes("architecture"))
  ) {
    steps.push(
      createStep({
        index: 1,
        tool: "query_graph",
        reason: "Use existing repo graph to answer architecture question.",
        stepInput: {
          projectId: input.projectId,
          query: input.objective,
        },
      }),
    );
  } else if (
    q.includes("github.com") ||
    q.includes("analyze repo") ||
    q.includes("repository")
  ) {
    steps.push(
      createStep({
        index: 1,
        tool: "github_repo",
        reason: "Analyze GitHub repository.",
        stepInput: {
          projectId: input.projectId,
          query: input.objective,
        },
      }),
    );
  } else if (
    q.includes("current") ||
    q.includes("latest") ||
    q.includes("docs") ||
    q.includes("api") ||
    q.includes("compare")
  ) {
    steps.push(
      createStep({
        index: 1,
        tool: "web_research",
        reason: "Use web research for current/external information.",
        stepInput: {
          projectId: input.projectId,
          userId: input.userId,
          query: input.objective,
        },
      }),
    );
  } else {
    steps.push(
      createStep({
        index: 1,
        tool: "search_kb",
        reason: "Start with project knowledge base.",
        stepInput: {
          projectId: input.projectId,
          query: input.objective,
        },
      }),
    );
  }

  return {
    id: `plan-${Date.now()}`,
    objective: input.objective,
    steps,
    createdAt: new Date().toISOString(),
    planner: "deterministic",
  };
}
