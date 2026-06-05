export type Project = {
  id: string;
  name: string;
  description?: string | null;
  createdAt: string;
};

export type AgentStep = {
  id: string;
  stepIndex: number;
  code?: string | null;
  stdout?: string | null;
  stderr?: string | null;
  result?: unknown;
  createdAt: string;
};

export type AgentRun = {
  id: string;
  query: string;
  status: string;
  depth: number;
  finalOutput?: unknown;
  steps: AgentStep[];
};

export type Report = {
  id: string;
  title: string;
  content: string;
  metadata?: unknown;
  createdAt: string;
};

export type ResearchJob = {
  id: string;
  projectId: string;
  question: string;
  status: string;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
  reports?: Report[];
  agentRuns?: AgentRun[];
};
