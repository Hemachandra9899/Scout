import type {
  PythonExecutionResult,
  SandboxBudget,
  SandboxSafetyDebug,
  SubAgentHandler,
  ToolHandler,
} from "../types.ts";
import { executePythonInProcess } from "./pythonSandboxCore.ts";
import type {
  WorkerToParentMessage,
} from "./pythonSandboxWorkerProtocol.ts";

const DEFAULT_SANDBOX_BUDGET: SandboxBudget = {
  timeoutMs: 30_000,
  maxStdoutChars: 20_000,
  maxStderrChars: 10_000,
  maxToolCalls: 12,
};

const SANDBOX_TOOL_NAMES = [
  "crawl_url",
  "search_kb",
  "web_research",
  "github_repo",
  "query_graph",
  "llm_query",
];

function resolveBudget(input?: Partial<SandboxBudget>): SandboxBudget {
  return { ...DEFAULT_SANDBOX_BUDGET, ...(input ?? {}) };
}

function sandboxIsolationMode(): "worker" | "in_process" {
  const mode = Deno.env.get("RLM_SANDBOX_ISOLATION_MODE");
  if (mode === "in_process") return "in_process";
  return "worker";
}

function createTimeoutResult(budget: SandboxBudget): PythonExecutionResult {
  return {
    stdout: "",
    stderr: "",
    final: null,
    finalCalled: false,
    error: `Sandbox worker execution timed out after ${budget.timeoutMs}ms and was terminated.`,
    toolCalls: [],
    safety: {
      budget,
      timedOut: true,
      killed: true,
      stdoutSize: 0,
      stderrSize: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
      toolCallCount: 0,
      toolCallLimitHit: false,
      isolationMode: "worker",
    },
  };
}

function createErrorResult(
  budget: SandboxBudget,
  errorMessage: string,
): PythonExecutionResult {
  return {
    stdout: "",
    stderr: "",
    final: null,
    finalCalled: false,
    error: errorMessage,
    toolCalls: [],
    safety: {
      budget,
      timedOut: false,
      killed: true,
      stdoutSize: 0,
      stderrSize: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
      toolCallCount: 0,
      toolCallLimitHit: false,
      isolationMode: "worker",
    },
  };
}

function extractSafety(
  result: PythonExecutionResult,
  budget: SandboxBudget,
  overrides: Partial<SandboxSafetyDebug>,
): SandboxSafetyDebug | undefined {
  if (!result.safety) return undefined;
  return { ...result.safety, ...overrides, budget: result.safety.budget ?? budget };
}

async function executePythonInWorker(input: {
  code: string;
  budget: SandboxBudget;
}): Promise<PythonExecutionResult> {
  const workerUrl = new URL("./pythonSandboxWorker.ts", import.meta.url).href;
  const worker = new Worker(workerUrl, { type: "module" });

  const requestId = crypto.randomUUID();

  return await new Promise<PythonExecutionResult>((resolve) => {
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;

      try {
        worker.terminate();
      } catch {
        // ignore terminate error
      }

      resolve(createTimeoutResult(input.budget));
    }, input.budget.timeoutMs);

    worker.onerror = (event) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);

      try {
        worker.terminate();
      } catch {
        // ignore terminate error
      }

      resolve(createErrorResult(input.budget, event.message || "Sandbox worker error."));
    };

    worker.onmessage = (event: MessageEvent<WorkerToParentMessage>) => {
      const response = event.data;

      if (response.type === "execute_response") {
        if (response.id !== requestId || settled) return;

        settled = true;
        clearTimeout(timeout);

        try {
          worker.terminate();
        } catch {
          // ignore terminate error
        }

        if (response.ok) {
          resolve({
            ...response.result,
            safety: extractSafety(response.result, input.budget, {
              killed: false,
              isolationMode: "worker",
            }),
          });
          return;
        }

        resolve(createErrorResult(input.budget, response.error));
      }
    };

    const request = {
      type: "execute_request" as const,
      id: requestId,
      code: input.code,
      budget: input.budget,
      toolNames: SANDBOX_TOOL_NAMES,
    };

    worker.postMessage(request);
  });
}

async function executePythonInWorkerWithTools(input: {
  code: string;
  budget: SandboxBudget;
  toolHandler?: ToolHandler;
  subAgentHandler?: SubAgentHandler;
}): Promise<PythonExecutionResult> {
  const workerUrl = new URL("./pythonSandboxWorker.ts", import.meta.url).href;
  const worker = new Worker(workerUrl, { type: "module" });

  const requestId = crypto.randomUUID();

  const result = await new Promise<PythonExecutionResult>((resolve) => {
    let settled = false;
    let toolCallCount = 0;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;

      try {
        worker.terminate();
      } catch {
        // ignore terminate error
      }

      resolve(createTimeoutResult(input.budget));
    }, input.budget.timeoutMs);

    worker.onerror = (event) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);

      try {
        worker.terminate();
      } catch {
        // ignore terminate error
      }

      resolve(createErrorResult(input.budget, event.message || "Sandbox worker error."));
    };

    worker.onmessage = async (event: MessageEvent<WorkerToParentMessage>) => {
      const msg = event.data;

      if (msg.type === "tool_request") {
        if (msg.id !== requestId) return;

        toolCallCount += 1;
        if (toolCallCount > input.budget.maxToolCalls) {
          const toolResponse = {
            type: "tool_response" as const,
            toolRequestId: msg.toolRequestId,
            ok: false as const,
            error: `Sandbox tool-call budget exceeded: ${input.budget.maxToolCalls}`,
          };
          worker.postMessage(toolResponse);
          return;
        }

        try {
          let result: unknown;

          if (msg.name === "llm_query" && input.subAgentHandler) {
            const prompt = String(msg.args.prompt ?? "");
            const context = msg.args.context ?? {};
            result = await input.subAgentHandler(prompt, context);
          } else if (input.toolHandler) {
            result = await input.toolHandler(msg.name, msg.args);
          } else {
            throw new Error(`No tool handler available for "${msg.name}".`);
          }

          const toolResponse = {
            type: "tool_response" as const,
            toolRequestId: msg.toolRequestId,
            ok: true as const,
            result,
          };
          worker.postMessage(toolResponse);
        } catch (error) {
          const toolResponse = {
            type: "tool_response" as const,
            toolRequestId: msg.toolRequestId,
            ok: false as const,
            error: error instanceof Error ? error.message : String(error),
          };
          worker.postMessage(toolResponse);
        }
        return;
      }

      if (msg.type === "execute_response") {
        if (msg.id !== requestId || settled) return;

        settled = true;
        clearTimeout(timeout);

        try {
          worker.terminate();
        } catch {
          // ignore terminate error
        }

        if (msg.ok) {
          resolve({
            ...msg.result,
            safety: extractSafety(msg.result, input.budget, {
              killed: false,
              isolationMode: "worker_tool_rpc",
            }),
          });
          return;
        }

        resolve(createErrorResult(input.budget, msg.error));
      }
    };

    const request = {
      type: "execute_request" as const,
      id: requestId,
      code: input.code,
      budget: input.budget,
      toolNames: SANDBOX_TOOL_NAMES,
    };

    worker.postMessage(request);
  });

  return result;
}

type ExecuteOptions = {
  budget?: Partial<SandboxBudget>;
  subAgentHandler?: SubAgentHandler;
  toolHandler?: ToolHandler;
};

export class PythonSandbox {
  async execute(
    code: string,
    optionsOrHandler?: ExecuteOptions | SubAgentHandler,
    legacyToolHandler?: ToolHandler,
  ): Promise<PythonExecutionResult> {
    let options: ExecuteOptions;
    if (typeof optionsOrHandler === "function") {
      options = { subAgentHandler: optionsOrHandler, toolHandler: legacyToolHandler };
    } else {
      options = optionsOrHandler ?? {};
    }

    const budget = resolveBudget(options.budget);

    if (sandboxIsolationMode() === "in_process") {
      return executePythonInProcess({
        code,
        budget,
        subAgentHandler: options.subAgentHandler,
        toolHandler: options.toolHandler,
      });
    }

    if (options.subAgentHandler || options.toolHandler) {
      return executePythonInWorkerWithTools({
        code,
        budget,
        toolHandler: options.toolHandler,
        subAgentHandler: options.subAgentHandler,
      });
    }

    return executePythonInWorker({
      code,
      budget,
    });
  }
}
