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

function isComparisonQuery(query: string) {
  const q = query.toLowerCase();

  return (
    q.includes("compare") ||
    q.includes("comparison") ||
    q.includes(" vs ") ||
    q.includes(" versus ") ||
    (q.includes(" and ") && (q.includes("api") || q.includes("docs")))
  );
}

function splitComparisonTargets(query: string): string[] {
  const normalized = query.trim();

  if (
    normalized.toLowerCase().includes("google ads") &&
    normalized.toLowerCase().includes("meta")
  ) {
    return ["Google Ads API", "Meta Marketing API"];
  }

  const parts = normalized
    .split(/\s+(?:vs|versus|and)\s+/i)
    .map((part) => part.trim())
    .filter(Boolean);

  return parts.length >= 2 ? parts.slice(0, 3) : [];
}

export function buildDeterministicAgentPlan(input: {
  objective: string;
  projectId: string;
  userId?: string;
}): AgentPlan {
  const q = input.objective.toLowerCase();

  if (isComparisonQuery(input.objective)) {
    const targets = splitComparisonTargets(input.objective);

    if (targets.length >= 2) {
      const steps = targets.map((target, index) =>
        createStep({
          index: index + 1,
          tool: "web_research",
          reason: `Research ${target} independently for the comparison.`,
          stepInput: {
            projectId: input.projectId,
            userId: input.userId,
            query: `${target}: ${input.objective}`,
          },
        }),
      );

      return {
        id: `plan-${Date.now()}`,
        objective: input.objective,
        steps,
        createdAt: new Date().toISOString(),
        planner: "deterministic",
      };
    }
  }

  if (
    q.includes("repo") &&
    q.includes("graph") &&
    (q.includes("explain") || q.includes("summarize") || q.includes("architecture"))
  ) {
    return {
      id: `plan-${Date.now()}`,
      objective: input.objective,
      steps: [
        createStep({
          index: 1,
          tool: "query_graph",
          reason: "Query repo graph for architecture context.",
          stepInput: {
            projectId: input.projectId,
            query: input.objective,
          },
        }),
        createStep({
          index: 2,
          tool: "search_kb",
          reason: "Search project knowledge for supporting context.",
          stepInput: {
            projectId: input.projectId,
            query: input.objective,
          },
        }),
      ],
      createdAt: new Date().toISOString(),
      planner: "deterministic",
    };
  }

  if (
    q.includes("repo") &&
    (q.includes("graph") || q.includes("architecture"))
  ) {
    return {
      id: `plan-${Date.now()}`,
      objective: input.objective,
      steps: [
        createStep({
          index: 1,
          tool: "query_graph",
          reason: "Use existing repo graph to answer architecture question.",
          stepInput: {
            projectId: input.projectId,
            query: input.objective,
          },
        }),
      ],
      createdAt: new Date().toISOString(),
      planner: "deterministic",
    };
  }

  if (
    q.includes("github.com") ||
    q.includes("analyze repo") ||
    q.includes("repository")
  ) {
    return {
      id: `plan-${Date.now()}`,
      objective: input.objective,
      steps: [
        createStep({
          index: 1,
          tool: "github_repo",
          reason: "Analyze GitHub repository.",
          stepInput: {
            projectId: input.projectId,
            query: input.objective,
          },
        }),
      ],
      createdAt: new Date().toISOString(),
      planner: "deterministic",
    };
  }

  if (
    q.includes("current") ||
    q.includes("latest") ||
    q.includes("docs") ||
    q.includes("api") ||
    q.includes("compare")
  ) {
    return {
      id: `plan-${Date.now()}`,
      objective: input.objective,
      steps: [
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
      ],
      createdAt: new Date().toISOString(),
      planner: "deterministic",
    };
  }

  return {
    id: `plan-${Date.now()}`,
    objective: input.objective,
    steps: [
      createStep({
        index: 1,
        tool: "search_kb",
        reason: "Start with project knowledge base.",
        stepInput: {
          projectId: input.projectId,
          query: input.objective,
        },
      }),
    ],
    createdAt: new Date().toISOString(),
    planner: "deterministic",
  };
}
