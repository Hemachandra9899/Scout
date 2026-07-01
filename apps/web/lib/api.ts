const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

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

export type ProjectDocument = {
  id: string;
  projectId: string;
  sourceUrl?: string | null;
  title?: string | null;
  markdown: string;
  contentHash?: string | null;
  metadata?: unknown;
  createdAt: string;
  _count?: {
    chunks: number;
  };
};

export type IngestFileResponse = {
  status: string;
  filename: string;
  title: string;
  documentId: string;
  chunksCreated: number;
  chunksTotal: number;
  embeddedChunks: number;
  embeddingError?: string | null;
  deduped: boolean;
  markdownPreview: string;
};

export async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return res.json();
}

export const api = {
  health: () => request<{ status: string; service: string }>("/health"),
  deps: () => request<Record<string, string>>("/health/deps"),

  listProjects: () => request<Project[]>("/projects"),
  createProject: (body: { name: string; description?: string }) =>
    request<Project>("/projects", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  listProjectJobs: (projectId: string) =>
    request<ResearchJob[]>(`/projects/${projectId}/jobs`),

  createResearchJob: (body: {
    projectId: string;
    conversationId?: string;
    question: string;
  }) =>
    request<{ jobId: string; conversationId: string; status: string }>(
      "/research-jobs",
      { method: "POST", body: JSON.stringify(body) },
    ),

  getResearchJob: (jobId: string) =>
    request<ResearchJob>(`/research-jobs/${jobId}`),

  getResearchJobStatus: (jobId: string) =>
    request<ResearchJobStatus>(`/research-jobs/${jobId}/status`),

  listProjectConversations: (projectId: string) =>
    request<Conversation[]>(`/projects/${projectId}/conversations`),

  createConversation: (body: { projectId: string; title?: string }) =>
    request<Conversation>("/conversations", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  getConversation: (id: string) =>
    request<Conversation>(`/conversations/${id}`),

  listProjectDocuments: (projectId: string) =>
    request<ProjectDocument[]>(`/projects/${projectId}/documents`),

  listDocumentChunks: (documentId: string) => request<any[]>(`/documents/${documentId}/chunks`),

  ingestFile: async (body: {
    projectId: string;
    file: File;
    sourceUrl?: string;
  }) => {
    const formData = new FormData();
    formData.append("projectId", body.projectId);
    formData.append("file", body.file);

    if (body.sourceUrl) {
      formData.append("sourceUrl", body.sourceUrl);
    }

    const res = await fetch(`${API_URL}/tools/ingest-file`, {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${res.status} ${res.statusText}: ${text}`);
    }

    return res.json() as Promise<IngestFileResponse>;
  },

  getLatestGraphReport: (projectId: string) =>
    request<{
      status: string;
      report: Report;
      download: { markdown: string; json: string };
    }>(`/graph-reports/latest?projectId=${projectId}`),

  getGraphReport: (reportId: string) =>
    request<{
      status: string;
      report: Report;
      download: { markdown: string; json: string };
    }>(`/graph-reports/${reportId}`),

  uploadMemory: (body: {
    projectId: string;
    text: string;
    kind?: string;
    scope?: string;
  }) =>
    request<{ written: number }>("/memories/upload", {
      method: "POST",
      body: JSON.stringify(body),
    }),
};

export type ChatStreamBody = {
  projectId?: string;
  userId?: string;
  query: string;
  mode?: string;
  conversationId?: string;
  context?: { hasDocument?: boolean };
};

/** Open the streaming chat endpoint and invoke onEvent for each SSE event. */
export async function chatStream(
  body: ChatStreamBody,
  onEvent: (event: string, data: any) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${API_URL}/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`${res.status} chat stream failed`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);

      let event = "message";
      let dataRaw = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataRaw += line.slice(5).trim();
      }
      if (!dataRaw) continue;
      try {
        onEvent(event, JSON.parse(dataRaw));
      } catch {
        /* ignore malformed event */
      }
    }
  }
}
