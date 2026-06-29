import type {
  PythonExecutionResult,
  SandboxBudget,
  SandboxSafetyDebug,
  SubAgentHandler,
  ToolHandler,
} from "../types.ts";
import { executePythonInProcess } from "./pythonSandboxCore.ts";
import type {
  PythonSandboxWorkerRequest,
  PythonSandboxWorkerResponse,
} from "./pythonSandboxWorkerProtocol.ts";

const DEFAULT_SANDBOX_BUDGET: SandboxBudget = {
  timeoutMs: 30_000,
  maxStdoutChars: 20_000,
  maxStderrChars: 10_000,
  maxToolCalls: 12,
};

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

    worker.onmessage = (event: MessageEvent<PythonSandboxWorkerResponse>) => {
      const response = event.data;

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
    };

    const request: PythonSandboxWorkerRequest = {
      id: requestId,
      code: input.code,
      budget: input.budget,
    };

    worker.postMessage(request);
  });
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
      return executePythonInProcess({
        code,
        budget,
        subAgentHandler: options.subAgentHandler,
        toolHandler: options.toolHandler,
      });
    }

    return executePythonInWorker({
      code,
      budget,
    });
  }
}
