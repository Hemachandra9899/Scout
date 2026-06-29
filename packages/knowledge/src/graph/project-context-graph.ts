export type ProjectGraphNode = {
  id: string;
  label: string;
  type: "service" | "package" | "tool" | "storage" | "artifact";
  aliases: string[];
};

export type ProjectGraphEdge = {
  source: string;
  target: string;
  relation: string;
  description: string;
};

export type ProjectGraphContext = {
  used: boolean;
  reason: string;
  nodes: ProjectGraphNode[];
  edges: ProjectGraphEdge[];
  summary: string;
  promptContext: string;
};

const SCOUT_NODES: ProjectGraphNode[] = [
  {
    id: "web",
    label: "Web UI",
    type: "service",
    aliases: ["web", "frontend", "next.js", "ui"],
  },
  {
    id: "api",
    label: "API server",
    type: "service",
    aliases: ["api", "fastify", "router", "api server"],
  },
  {
    id: "worker",
    label: "Worker",
    type: "service",
    aliases: ["worker", "bullmq worker", "background worker"],
  },
  {
    id: "rlm-runtime",
    label: "RLM runtime",
    type: "service",
    aliases: ["rlm runtime", "runtime", "sandbox runtime"],
  },
  {
    id: "tools",
    label: "Tools",
    type: "tool",
    aliases: ["tools", "tool calls", "approved tools"],
  },
  {
    id: "knowledge",
    label: "Knowledge package",
    type: "package",
    aliases: ["knowledge", "research orchestrator", "researchorchestrator"],
  },
  {
    id: "model-service",
    label: "Model service",
    type: "service",
    aliases: ["model service", "fastapi", "scrapling"],
  },
  {
    id: "qdrant",
    label: "Qdrant",
    type: "storage",
    aliases: ["qdrant", "vector db", "vector store"],
  },
  {
    id: "redis",
    label: "Redis/BullMQ",
    type: "storage",
    aliases: ["redis", "bullmq", "queue"],
  },
  {
    id: "answer",
    label: "Final answer",
    type: "artifact",
    aliases: ["answer", "final answer", "response"],
  },
];

const SCOUT_EDGES: ProjectGraphEdge[] = [
  {
    source: "web",
    target: "api",
    relation: "calls",
    description: "The Web UI sends user queries to the API server.",
  },
  {
    source: "api",
    target: "redis",
    relation: "queues",
    description: "The API can enqueue research jobs through Redis/BullMQ.",
  },
  {
    source: "redis",
    target: "worker",
    relation: "dispatches_to",
    description: "BullMQ dispatches queued jobs to the Worker.",
  },
  {
    source: "worker",
    target: "rlm-runtime",
    relation: "calls",
    description: "The Worker calls the RLM runtime for sandbox/tool-driven execution.",
  },
  {
    source: "api",
    target: "knowledge",
    relation: "calls",
    description: "The API calls the Knowledge package for KB search and web research.",
  },
  {
    source: "rlm-runtime",
    target: "tools",
    relation: "invokes",
    description: "The RLM runtime invokes approved tools during multi-step execution.",
  },
  {
    source: "tools",
    target: "knowledge",
    relation: "can_call",
    description: "Tools can call research, crawl, KB, GitHub, and graph capabilities.",
  },
  {
    source: "knowledge",
    target: "qdrant",
    relation: "retrieves_from",
    description: "The Knowledge/Retrieval layer searches Qdrant for project knowledge.",
  },
  {
    source: "knowledge",
    target: "model-service",
    relation: "uses",
    description: "Research uses the model service and Scrapling for model/scraping utilities.",
  },
  {
    source: "knowledge",
    target: "answer",
    relation: "synthesizes",
    description: "The Knowledge package synthesizes grounded answers from evidence.",
  },
  {
    source: "rlm-runtime",
    target: "answer",
    relation: "returns",
    description: "The RLM runtime returns execution results that become part of the final answer.",
  },
  {
    source: "api",
    target: "answer",
    relation: "returns",
    description: "The API returns the final answer, citations, and debug signals to the UI.",
  },
];

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function queryMentionsNode(query: string, node: ProjectGraphNode): boolean {
  const q = normalize(query);
  return [node.label, ...node.aliases].some((alias) => q.includes(normalize(alias)));
}

export function shouldUseProjectGraphContext(query: string): boolean {
  const q = normalize(query);

  const asksRelationship =
    q.includes("which component") ||
    q.includes("how does") ||
    q.includes("connect") ||
    q.includes("calls") ||
    q.includes("called by") ||
    q.includes("flow") ||
    q.includes("architecture");

  const mentionsScoutRuntime =
    q.includes("scout") &&
    (q.includes("rlm runtime") ||
      q.includes("worker") ||
      q.includes("tools") ||
      q.includes("final answer") ||
      q.includes("component"));

  return asksRelationship && mentionsScoutRuntime;
}

export function buildProjectGraphContext(query: string): ProjectGraphContext {
  if (!shouldUseProjectGraphContext(query)) {
    return {
      used: false,
      reason: "Query does not require project graph context.",
      nodes: [],
      edges: [],
      summary: "",
      promptContext: "",
    };
  }

  const directlyMentioned = SCOUT_NODES.filter((node) => queryMentionsNode(query, node));
  const mentionedIds = new Set(directlyMentioned.map((node) => node.id));

  const selectedEdges = SCOUT_EDGES.filter(
    (edge) => mentionedIds.has(edge.source) || mentionedIds.has(edge.target),
  );

  const fallbackEdges = SCOUT_EDGES.filter((edge) =>
    ["worker", "rlm-runtime", "tools", "knowledge", "answer", "api"].includes(edge.source) ||
    ["worker", "rlm-runtime", "tools", "knowledge", "answer", "api"].includes(edge.target),
  );

  const edges = (selectedEdges.length > 0 ? selectedEdges : fallbackEdges).slice(0, 10);

  const nodeIds = new Set(edges.flatMap((edge) => [edge.source, edge.target]));
  const nodes = SCOUT_NODES.filter((node) => nodeIds.has(node.id));

  const summary = [
    "Scout architecture graph:",
    "- The API receives user requests and can hand work to the Worker through Redis/BullMQ.",
    "- The Worker calls the RLM runtime for sandbox/tool-driven execution.",
    "- The RLM runtime invokes approved tools.",
    "- Tools can call research, crawl, KB, GitHub, and graph capabilities.",
    "- The Knowledge package retrieves evidence and synthesizes grounded answers.",
    "- The API returns the final answer, citations, and debug signals to the UI.",
  ].join("\n");

  const edgeLines = edges.map((edge) => {
    const source = SCOUT_NODES.find((node) => node.id === edge.source)?.label ?? edge.source;
    const target = SCOUT_NODES.find((node) => node.id === edge.target)?.label ?? edge.target;
    return `- ${source} --${edge.relation}--> ${target}: ${edge.description}`;
  });

  const promptContext = [
    "PROJECT GRAPH CONTEXT:",
    summary,
    "",
    "Relevant relationships:",
    ...edgeLines,
    "",
    "Use this graph context only for architecture/component relationships.",
    "Do not treat graph context as external factual evidence.",
  ].join("\n");

  return {
    used: true,
    reason: "Scout architecture relationship query detected.",
    nodes,
    edges,
    summary,
    promptContext,
  };
}
