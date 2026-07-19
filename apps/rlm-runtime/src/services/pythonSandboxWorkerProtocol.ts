import type {
  PythonExecutionResult,
  SandboxBudget,
} from "../types.ts";

export type WorkerExecuteRequest = {
  type: "execute_request";
  id: string;
  code: string;
  budget: SandboxBudget;
  toolNames: string[];
};

export type WorkerToolRequest = {
  type: "tool_request";
  id: string;
  toolRequestId: string;
  name: string;
  args: Record<string, unknown>;
};

export type WorkerExecuteResponse =
  | {
      type: "execute_response";
      id: string;
      ok: true;
      result: PythonExecutionResult;
    }
  | {
      type: "execute_response";
      id: string;
      ok: false;
      error: string;
      result?: PythonExecutionResult;
    };

export type WorkerToolResponse = {
  type: "tool_response";
  toolRequestId: string;
  ok: true;
  result: unknown;
};

export type WorkerToolErrorResponse = {
  type: "tool_response";
  toolRequestId: string;
  ok: false;
  error: string;
};

export type ParentToWorkerMessage = WorkerExecuteRequest | WorkerToolResponse | WorkerToolErrorResponse;
export type WorkerToParentMessage = WorkerToolRequest | WorkerExecuteResponse;
