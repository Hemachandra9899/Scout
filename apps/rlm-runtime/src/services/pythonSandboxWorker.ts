import { executePythonInProcess } from "./pythonSandboxCore.ts";
import type {
  ParentToWorkerMessage,
  WorkerExecuteResponse,
  WorkerToolRequest,
} from "./pythonSandboxWorkerProtocol.ts";
import type { SandboxBudget } from "../types.ts";

declare const self: {
  onmessage: ((event: MessageEvent<ParentToWorkerMessage>) => void) | null;
  postMessage(message: unknown): void;
};

const pendingToolRequests = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (reason: unknown) => void }
>();

let activeRequestId: string | null = null;

function requestToolExecution(
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  if (!activeRequestId) {
    return Promise.reject(new Error("No active execution context for tool call."));
  }

  const toolRequestId = crypto.randomUUID();

  return new Promise((resolve, reject) => {
    pendingToolRequests.set(toolRequestId, { resolve, reject });

    const message: WorkerToolRequest = {
      type: "tool_request",
      id: activeRequestId!,
      toolRequestId,
      name,
      args,
    };

    self.postMessage(message);
  });
}

self.onmessage = (event: MessageEvent<ParentToWorkerMessage>) => {
  const msg = event.data;

  if (msg.type === "tool_response") {
    const pending = pendingToolRequests.get(msg.toolRequestId);
    if (!pending) return;

    pendingToolRequests.delete(msg.toolRequestId);

    if (msg.ok) {
      pending.resolve(msg.result);
    } else {
      pending.reject(new Error(msg.error));
    }
    return;
  }

  if (msg.type === "execute_request") {
    activeRequestId = msg.id;

    const budget: SandboxBudget = msg.budget;
    const toolNames = new Set(msg.toolNames);

    executePythonInProcess({
      code: msg.code,
      budget,
      toolHandler:
        toolNames.size > 0
          ? async (name: string, args: Record<string, unknown>) => {
              if (!toolNames.has(name)) {
                throw new Error(`Tool "${name}" is not available in sandbox.`);
              }
              return requestToolExecution(name, args);
            }
          : undefined,
    })
      .then((result) => {
        const response: WorkerExecuteResponse = {
          type: "execute_response",
          id: msg.id,
          ok: true,
          result: {
            ...result,
            safety: result.safety
              ? {
                  ...result.safety,
                  isolationMode: pendingToolRequests.size > 0 ? "worker_tool_rpc" : "worker",
                }
              : undefined,
          },
        };
        self.postMessage(response);
      })
      .catch((error) => {
        const response: WorkerExecuteResponse = {
          type: "execute_response",
          id: msg.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
        self.postMessage(response);
      })
      .finally(() => {
        activeRequestId = null;
        for (const [id, pending] of pendingToolRequests) {
          pending.reject(new Error("Execution completed while tool call was pending."));
          pendingToolRequests.delete(id);
        }
      });
  }
};
