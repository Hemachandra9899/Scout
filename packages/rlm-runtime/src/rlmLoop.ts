import { sanitizeGeneratedPython, truncateText } from "./codeUtils.ts";
import { ModelClient } from "./modelClient.ts";
import { PythonSandbox } from "./pythonSandbox.ts";
import type {
  ChatMessage,
  ExecuteRequest,
  RlmRunResult,
  RlmStep,
  SubAgentHandler,
} from "./types.ts";

const DEFAULT_MAX_STEPS = 5;
const DEFAULT_MAX_DEPTH = 2;

const SYSTEM_PROMPT = `
You are running inside RLM Forge, a Recursive Language Model Python execution environment.

You must write Python code only.

Available functions:
- print(value): inspect intermediate values
- final(value): return the final answer and stop execution
- await llm_query(prompt: str, context: dict = None): spawn a recursive child agent and return its final result

Rules:
1. Return only executable Python code.
2. Do not use markdown.
3. Do not wrap code in triple backticks.
4. Do not explain.
5. Always call final(...) when the task is complete.
6. Keep code simple.
7. Use await llm_query(...) only for independent subtasks.
8. Child agent results are returned as Python values.
9. Prefer JSON-serializable dict/list/string/number outputs.
10. Use only Python standard library unless clearly unnecessary.
`.trim();

function buildInitialMessages(
  query: string,
  depth: number,
  maxDepth: number,
): ChatMessage[] {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        `User task:`,
        query,
        "",
        `Current recursion depth: ${depth}`,
        `Maximum recursion depth: ${maxDepth}`,
        "",
        "Write the next Python code block to solve this task.",
      ].join("\n"),
    },
  ];
}

function buildExecutionFeedback(step: RlmStep): string {
  return `
Execution result for step ${step.stepIndex}:

Code:
${step.generatedCode}

stdout:
${truncateText(step.stdout, 4000)}

error:
${step.error ?? "None"}

finalCalled:
${step.finalCalled}

final:
${JSON.stringify(step.final)}

If finalCalled is false and there is no fatal error, write the next Python code block.
If there is an error, fix it with the next code block.
`.trim();
}

function childRunId(
  parentRunId: string | undefined,
  depth: number,
): string | undefined {
  if (!parentRunId) return undefined;
  return `${parentRunId}:child:${depth}:${crypto.randomUUID()}`;
}

export class RlmLoop {
  private readonly modelClient: ModelClient;
  private readonly sandbox: PythonSandbox;

  constructor(
    modelClient = new ModelClient(),
    sandbox = new PythonSandbox(),
  ) {
    this.modelClient = modelClient;
    this.sandbox = sandbox;
  }

  async run(req: ExecuteRequest): Promise<RlmRunResult> {
    const depth = Math.max(0, req.depth ?? 0);
    const maxDepth = Math.max(0, req.maxDepth ?? DEFAULT_MAX_DEPTH);
    const maxSteps = Math.max(
      1,
      Math.min(req.maxSteps ?? DEFAULT_MAX_STEPS, 10),
    );

    const messages = buildInitialMessages(req.query, depth, maxDepth);
    const steps: RlmStep[] = [];

    const subAgentHandler: SubAgentHandler = async (
      prompt: string,
      _context?: unknown,
    ) => {
      if (depth >= maxDepth) {
        return {
          error:
            `Maximum recursion depth ${maxDepth} reached. Solve manually in the current agent.`,
        };
      }

      const childResult = await this.run({
        runId: childRunId(req.runId, depth + 1),
        projectId: req.projectId,
        query: prompt,
        maxSteps,
        depth: depth + 1,
        maxDepth,
      });

      if (childResult.status !== "completed") {
        return {
          error:
            childResult.error ??
            `Child agent ended with status ${childResult.status}`,
          status: childResult.status,
        };
      }

      return childResult.final;
    };

    try {
      for (let stepIndex = 0; stepIndex < maxSteps; stepIndex++) {
        const rawCode = await this.modelClient.chatCoding(messages);
        const generatedCode = sanitizeGeneratedPython(rawCode);
        const execution = await this.sandbox.execute(
          generatedCode,
          subAgentHandler,
        );

        const step: RlmStep = {
          stepIndex,
          generatedCode,
          stdout: execution.stdout,
          final: execution.final,
          finalCalled: execution.finalCalled,
          error: execution.error,
        };

        steps.push(step);

        messages.push({ role: "assistant", content: generatedCode });
        messages.push({
          role: "user",
          content: buildExecutionFeedback(step),
        });

        if (execution.finalCalled && !execution.error) {
          return {
            status: "completed",
            runId: req.runId,
            projectId: req.projectId,
            query: req.query,
            depth,
            maxDepth,
            final: execution.final,
            steps,
            error: null,
          };
        }
      }

      return {
        status: "max_steps_reached",
        runId: req.runId,
        projectId: req.projectId,
        query: req.query,
        depth,
        maxDepth,
        final: steps.at(-1)?.final ?? null,
        steps,
        error:
          "RLM loop reached maxSteps before final() completed successfully.",
      };
    } catch (error) {
      return {
        status: "failed",
        runId: req.runId,
        projectId: req.projectId,
        query: req.query,
        depth,
        maxDepth,
        final: null,
        steps,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
