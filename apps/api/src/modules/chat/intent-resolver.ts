import { routeScoutQuery } from "../routing/routing.service.js";

/** Where a chat turn is dispatched. */
export type ChatFlow =
  | "direct"
  | "web_research"
  | "github_repo"
  | "graph_query"
  | "kb"
  | "sandbox"
  | "agent";

/** A mode the user explicitly selected in the composer (`+` menu). "auto" = let intent decide. */
export type ChatMode =
  | "auto"
  | "web_research"
  | "deep_research"
  | "github_repo"
  | "agent"
  | "kb";

export type IntentDecision = {
  flow: ChatFlow;
  intent: string;
  confidence: number;
  normalizedQuery: string;
  reason: string;
  signals: string[];
  escalated: boolean;
};

export type IntentResolverInput = {
  query: string;
  mode?: ChatMode;
  /** Frontend context, e.g. an attached/active document. */
  context?: { hasDocument?: boolean };
};

/** A model-backed classifier result. Injected so the resolver is unit-testable without a model. */
export type ClassifierResult = {
  flow: ChatFlow;
  confidence: number;
  normalizedQuery?: string;
  reason?: string;
};

export type IntentResolverDeps = {
  classify?: (query: string) => Promise<ClassifierResult | null>;
  escalate?: (query: string) => Promise<ClassifierResult | null>;
};

const MODEL_SERVICE_URL =
  process.env.MODEL_SERVICE_URL || "http://model-service:8100";

const CONFIDENCE_THRESHOLD = Number(
  process.env.INTENT_CONFIDENCE_THRESHOLD || 0.6,
);

const ESCALATION_ENABLED = process.env.INTENT_ESCALATION_ENABLED !== "0";

const VALID_FLOWS: ChatFlow[] = [
  "direct",
  "web_research",
  "github_repo",
  "graph_query",
  "kb",
  "sandbox",
  "agent",
];

function modeToFlow(mode: ChatMode | undefined): ChatFlow | null {
  switch (mode) {
    case "web_research":
      return "web_research";
    case "deep_research":
      return "agent";
    case "github_repo":
      return "github_repo";
    case "agent":
      return "agent";
    case "kb":
      return "kb";
    default:
      return null;
  }
}

function isChitchat(query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return false;

  if (
    /^(hi|hey|hello|yo|sup|hiya|howdy|gm|good (morning|afternoon|evening|night))\b/.test(
      q,
    )
  ) {
    return true;
  }
  if (/^(thanks|thank you|thx|ty|cool|nice|great|ok|okay)\b/.test(q)) return true;
  if (
    /\b(what can you do|who are you|what are you|how do you work|what is scout|help me|can you help)\b/.test(
      q,
    )
  ) {
    return true;
  }
  // Very short, non-question conversational openers (e.g. "sounds good", "got it").
  // Kept to <=2 words so real 3-word commands ("summarize this repo", "reset my
  // password") aren't misrouted away from research/tooling.
  if (q.split(/\s+/).length <= 2 && !q.includes("?") && !/[/.@]/.test(q)) {
    return true;
  }
  return false;
}

/** Map a deterministic router decision to a chat flow. */
function flowFromRouterTool(tool: string): ChatFlow {
  switch (tool) {
    case "github_repo":
      return "github_repo";
    case "query_graph":
      return "graph_query";
    case "search_kb":
      return "kb";
    case "sandbox":
      return "sandbox";
    case "direct_model":
      return "direct";
    default:
      return "web_research";
  }
}

function parseClassifierJson(text: string): ClassifierResult | null {
  const tryParse = (s: string): Record<string, unknown> | null => {
    try {
      return JSON.parse(s) as Record<string, unknown>;
    } catch {
      return null;
    }
  };

  const json = tryParse(text.trim()) ?? tryParse(text.match(/\{[\s\S]*\}/)?.[0] ?? "");
  if (!json) return null;

  const flow = String(json.flow ?? "");
  if (!VALID_FLOWS.includes(flow as ChatFlow)) return null;

  const confidence = Number(json.confidence);
  return {
    flow: flow as ChatFlow,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.5,
    normalizedQuery:
      typeof json.normalizedQuery === "string" ? json.normalizedQuery : undefined,
    reason: typeof json.reason === "string" ? json.reason : undefined,
  };
}

const CLASSIFIER_SYSTEM_PROMPT = [
  "You are Scout's intent router. Classify the user's message into exactly one flow.",
  'Return ONLY JSON: {"flow":"...","confidence":0.0-1.0,"normalizedQuery":"...","reason":"..."}',
  "",
  "Flows:",
  '- direct: greetings, small talk, capability questions ("what can you do"), or simple questions answerable directly without external sources.',
  "- web_research: current events, news, prices, API/docs/comparisons, anything needing fresh web info.",
  "- github_repo: a GitHub repository URL or a request to analyze/graphify/summarize a repo.",
  "- graph_query: questions about an already-built code/repo graph or a graph report.",
  "- kb: questions about the user's uploaded documents or project knowledge base.",
  "- sandbox: explicit computation or data transformation on provided data.",
  "- agent: complex, multi-step, or ambiguous tasks needing several tools.",
  "",
  "Rules:",
  '- Prefer "direct" for conversational or simple-knowledge questions.',
  '- Use "agent" when unsure or when the task needs multiple steps.',
  "- normalizedQuery: fix obvious typos/abbreviations, otherwise echo the query.",
].join("\n");

async function callModelService(
  mode: "fast_intent" | "reasoning",
  query: string,
): Promise<ClassifierResult | null> {
  const response = await fetch(`${MODEL_SERVICE_URL}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode,
      messages: [
        { role: "system", content: CLASSIFIER_SYSTEM_PROMPT },
        { role: "user", content: query },
      ],
      temperature: 0,
      max_tokens: 256,
    }),
  });

  if (!response.ok) return null;
  const data = (await response.json()) as { content?: string };
  return parseClassifierJson(String(data.content ?? ""));
}

const defaultDeps: Required<IntentResolverDeps> = {
  classify: (query) => callModelService("fast_intent", query),
  escalate: (query) => callModelService("reasoning", query),
};

/**
 * Resolve the flow for a chat turn. Layered, deterministic-first:
 *   1. frontend mode override  2. chitchat  3. deterministic router signals
 *   4. flash classifier  5. reasoning escalation on low confidence.
 */
export async function resolveIntent(
  input: IntentResolverInput,
  deps: IntentResolverDeps = {},
): Promise<IntentDecision> {
  const classify = deps.classify ?? defaultDeps.classify;
  const escalate = deps.escalate ?? defaultDeps.escalate;
  const query = input.query.trim();

  // 1. Frontend mode override — highest priority.
  const overrideFlow = modeToFlow(input.mode);
  if (overrideFlow) {
    return {
      flow: overrideFlow,
      intent: input.mode!,
      confidence: 1,
      normalizedQuery: query,
      reason: "Frontend mode override.",
      signals: [`mode:${input.mode}`],
      escalated: false,
    };
  }

  // 2. Deterministic chitchat / capability.
  if (isChitchat(query)) {
    return {
      flow: "direct",
      intent: "direct",
      confidence: 0.95,
      normalizedQuery: query,
      reason: "Greeting / capability / simple conversational message.",
      signals: ["deterministic:chitchat"],
      escalated: false,
    };
  }

  // 2b. Strong deterministic router signals (github URL, graph, memo, sandbox, code, kb).
  //     The router's catch-all ("Defaulting unknown…") is weak — defer those to the classifier.
  const base = routeScoutQuery(query);
  const isRouterDefault = base.reason.toLowerCase().includes("defaulting unknown");
  if (input.context?.hasDocument) {
    return {
      flow: "kb",
      intent: "kb",
      confidence: 0.9,
      normalizedQuery: query,
      reason: "An uploaded document is attached to this turn.",
      signals: ["context:document"],
      escalated: false,
    };
  }
  if (!isRouterDefault) {
    return {
      flow: flowFromRouterTool(base.tool),
      intent: base.tool,
      confidence: 0.88,
      normalizedQuery: query,
      reason: `Deterministic router: ${base.reason}`,
      signals: [`router:${base.tool}`],
      escalated: false,
    };
  }

  // 3. Flash classifier.
  let decision = await classify(query).catch(() => null);
  let escalated = false;

  // 4. Reasoning escalation on low confidence.
  if (
    ESCALATION_ENABLED &&
    (!decision || decision.confidence < CONFIDENCE_THRESHOLD)
  ) {
    const better = await escalate(query).catch(() => null);
    if (better) {
      decision = better;
      escalated = true;
    }
  }

  if (!decision) {
    // No model available — fall back to the agent loop (safe default for substantive queries).
    return {
      flow: "agent",
      intent: "agent",
      confidence: 0.3,
      normalizedQuery: query,
      reason: "Classifier unavailable; defaulting substantive query to the agent loop.",
      signals: ["fallback:agent"],
      escalated,
    };
  }

  return {
    flow: decision.flow,
    intent: decision.flow,
    confidence: decision.confidence,
    normalizedQuery: decision.normalizedQuery?.trim() || query,
    reason: decision.reason || (escalated ? "Reasoning-model classification." : "Flash classification."),
    signals: [escalated ? "classifier:reasoning" : "classifier:flash"],
    escalated,
  };
}
