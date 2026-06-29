export type AgentToolName =
  | "search_kb"
  | "web_research"
  | "github_repo"
  | "query_graph"
  | "sandbox";

export type AgentStepStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

export type AgentStep = {
  id: string;
  tool: AgentToolName;
  input: Record<string, unknown>;
  reason: string;
  dependsOn?: string[];
};

export type AgentPlan = {
  id: string;
  objective: string;
  steps: AgentStep[];
  createdAt: string;
  planner: "deterministic" | "llm" | "manual";
};

export type AgentStepResult = {
  stepId: string;
  tool: AgentToolName;
  status: AgentStepStatus;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  output?: unknown;
  error?: string;
};

export type AgentExecutorBudget = {
  maxSteps: number;
  maxToolCalls: number;
  timeoutMs: number;
};

export type AgentExecutorTraceEvent = {
  id: string;
  timestamp: string;
  elapsedMs: number;
  type:
    | "agent_started"
    | "step_started"
    | "step_completed"
    | "step_failed"
    | "budget_exceeded"
    | "agent_completed"
    | "agent_failed";
  message: string;
  metadata?: Record<string, unknown>;
};

export type AgentExecutorProgressSink = (
  event: AgentExecutorTraceEvent,
) => void | Promise<void>;

export type AgentExecutorResult = {
  plan: AgentPlan;
  status: "completed" | "failed" | "budget_exceeded";
  stepResults: AgentStepResult[];
  finalSummary: string;
  debug: {
    agentExecutorUsed: true;
    budget: AgentExecutorBudget;
    stepCount: number;
    toolCallCount: number;
    durationMs: number;
    trace: AgentExecutorTraceEvent[];
  };
};
