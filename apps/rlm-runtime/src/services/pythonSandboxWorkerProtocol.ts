import type {
  PythonExecutionResult,
  SandboxBudget,
} from "../types.ts";

export type PythonSandboxWorkerRequest = {
  id: string;
  code: string;
  budget: SandboxBudget;
};

export type PythonSandboxWorkerResponse =
  | {
      id: string;
      ok: true;
      result: PythonExecutionResult;
    }
  | {
      id: string;
      ok: false;
      error: string;
      result?: PythonExecutionResult;
    };
