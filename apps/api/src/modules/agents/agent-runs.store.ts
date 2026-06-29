import type {
  AgentExecutorResult,
  AgentExecutorTraceEvent,
} from "@rlm-forge/knowledge/agent";

export type AgentRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed";

export type AgentRunRecord = {
  id: string;
  projectId: string;
  userId?: string;
  query: string;
  status: AgentRunStatus;
  createdAt: string;
  updatedAt: string;
  events: AgentExecutorTraceEvent[];
  result?: AgentExecutorResult;
  error?: string;
};

const runs = new Map<string, AgentRunRecord>();

export function createAgentRun(input: {
  projectId: string;
  userId?: string;
  query: string;
}) {
  const now = new Date().toISOString();

  const run: AgentRunRecord = {
    id: crypto.randomUUID(),
    projectId: input.projectId,
    userId: input.userId,
    query: input.query,
    status: "queued",
    createdAt: now,
    updatedAt: now,
    events: [],
  };

  runs.set(run.id, run);

  return run;
}

export function getAgentRun(runId: string) {
  return runs.get(runId) ?? null;
}

export function updateAgentRun(
  runId: string,
  patch: Partial<AgentRunRecord>,
) {
  const current = runs.get(runId);
  if (!current) return null;

  const updated = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };

  runs.set(runId, updated);

  return updated;
}

export function appendAgentRunEvent(
  runId: string,
  event: AgentExecutorTraceEvent,
) {
  const current = runs.get(runId);
  if (!current) return null;

  current.events.push(event);
  current.updatedAt = new Date().toISOString();

  return current;
}
