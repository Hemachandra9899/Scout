import type {
  PythonExecutionResult,
  SandboxBudget,
  SubAgentHandler,
  ToolHandler,
} from "../types.ts";
import { executePythonInProcess } from "./pythonSandboxCore.ts";

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

    return executePythonInProcess({
      code,
      budget: options.budget,
      subAgentHandler: options.subAgentHandler,
      toolHandler: options.toolHandler,
    });
  }
}
