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

export type ChatMessage = {
  id: string;
  role: string;
  content: string;
  createdAt: string;
};

export type Conversation = {
  id: string;
  projectId: string;
  title?: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  messages?: ChatMessage[];
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
  conversationId?: string | null;
  question: string;
  status: string;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
  reports?: Report[];
  agentRuns?: AgentRun[];
};

export type ResearchJobStatus = {
  id: string;
  status: string;
  error?: string | null;
  updatedAt: string;
};
