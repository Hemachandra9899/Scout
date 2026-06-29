import type {
  AgentExecutorBudget,
  AgentExecutorResult,
  AgentExecutorTraceEvent,
  AgentPlan,
  AgentStep,
  AgentStepResult,
} from "./agent-types.js";

export type AgentToolExecutor = (
  tool: AgentStep["tool"],
  input: Record<string, unknown>,
) => Promise<unknown>;

const DEFAULT_AGENT_BUDGET: AgentExecutorBudget = {
  maxSteps: 5,
  maxToolCalls: 8,
  timeoutMs: 120_000,
};

function resolveBudget(input?: Partial<AgentExecutorBudget>): AgentExecutorBudget {
  return { ...DEFAULT_AGENT_BUDGET, ...(input ?? {}) };
}

function summarizeStepOutput(output: unknown): string {
  if (typeof output === "string") return output.slice(0, 500);
  if (output && typeof output === "object") {
    const record = output as Record<string, unknown>;
    const text =
      record.answer ??
      record.final ??
      record.summary ??
      record.content ??
      record.markdown;
    if (typeof text === "string") return text.slice(0, 500);
  }
  return JSON.stringify(output).slice(0, 500);
}

export async function executeAgentPlan(input: {
  plan: AgentPlan;
  executeTool: AgentToolExecutor;
  budget?: Partial<AgentExecutorBudget>;
}): Promise<AgentExecutorResult> {
  const budget = resolveBudget(input.budget);
  const startedAt = Date.now();
  const trace: AgentExecutorTraceEvent[] = [];
  const stepResults: AgentStepResult[] = [];
  let toolCallCount = 0;

  function emit(event: Omit<AgentExecutorTraceEvent, "id" | "timestamp" | "elapsedMs">) {
    trace.push({
      id: `agent-event-${trace.length + 1}`,
      timestamp: new Date().toISOString(),
      elapsedMs: Date.now() - startedAt,
      ...event,
    });
  }

  emit({
    type: "agent_started",
    message: "Agent executor started.",
    metadata: { planId: input.plan.id, stepCount: input.plan.steps.length },
  });

  if (input.plan.steps.length > budget.maxSteps) {
    emit({
      type: "budget_exceeded",
      message: "Agent step budget exceeded before execution.",
      metadata: { maxSteps: budget.maxSteps, requestedSteps: input.plan.steps.length },
    });
    return {
      plan: input.plan,
      status: "budget_exceeded",
      stepResults,
      finalSummary: "Agent step budget exceeded before execution.",
      debug: {
        agentExecutorUsed: true,
        budget,
        stepCount: input.plan.steps.length,
        toolCallCount,
        durationMs: Date.now() - startedAt,
        trace,
      },
    };
  }

  for (const step of input.plan.steps) {
    if (Date.now() - startedAt > budget.timeoutMs) {
      emit({
        type: "budget_exceeded",
        message: "Agent timeout budget exceeded.",
        metadata: { timeoutMs: budget.timeoutMs },
      });
      return {
        plan: input.plan,
        status: "budget_exceeded",
        stepResults,
        finalSummary: "Agent timeout budget exceeded.",
        debug: {
          agentExecutorUsed: true,
          budget,
          stepCount: input.plan.steps.length,
          toolCallCount,
          durationMs: Date.now() - startedAt,
          trace,
        },
      };
    }

    if (toolCallCount >= budget.maxToolCalls) {
      emit({
        type: "budget_exceeded",
        message: "Agent tool-call budget exceeded.",
        metadata: { maxToolCalls: budget.maxToolCalls },
      });
      return {
        plan: input.plan,
        status: "budget_exceeded",
        stepResults,
        finalSummary: "Agent tool-call budget exceeded.",
        debug: {
          agentExecutorUsed: true,
          budget,
          stepCount: input.plan.steps.length,
          toolCallCount,
          durationMs: Date.now() - startedAt,
          trace,
        },
      };
    }

    const stepStartedAt = Date.now();

    emit({
      type: "step_started",
      message: `Starting ${step.tool}.`,
      metadata: { stepId: step.id, reason: step.reason },
    });

    toolCallCount += 1;

    try {
      const output = await input.executeTool(step.tool, step.input);

      const stepResult: AgentStepResult = {
        stepId: step.id,
        tool: step.tool,
        status: "completed",
        startedAt: new Date(stepStartedAt).toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - stepStartedAt,
        output,
      };

      stepResults.push(stepResult);

      emit({
        type: "step_completed",
        message: `${step.tool} completed.`,
        metadata: { stepId: step.id, durationMs: stepResult.durationMs },
      });
    } catch (error) {
      const stepResult: AgentStepResult = {
        stepId: step.id,
        tool: step.tool,
        status: "failed",
        startedAt: new Date(stepStartedAt).toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - stepStartedAt,
        error: error instanceof Error ? error.message : String(error),
      };

      stepResults.push(stepResult);

      emit({
        type: "step_failed",
        message: `${step.tool} failed.`,
        metadata: { stepId: step.id, error: stepResult.error },
      });

      return {
        plan: input.plan,
        status: "failed",
        stepResults,
        finalSummary: `Agent failed at ${step.id}: ${stepResult.error}`,
        debug: {
          agentExecutorUsed: true,
          budget,
          stepCount: input.plan.steps.length,
          toolCallCount,
          durationMs: Date.now() - startedAt,
          trace,
        },
      };
    }
  }

  emit({ type: "agent_completed", message: "Agent executor completed." });

  const summaries = stepResults
    .filter((result) => result.status === "completed")
    .map((result) => summarizeStepOutput(result.output));

  return {
    plan: input.plan,
    status: "completed",
    stepResults,
    finalSummary: summaries.join("\n\n").slice(0, 4000),
    debug: {
      agentExecutorUsed: true,
      budget,
      stepCount: input.plan.steps.length,
      toolCallCount,
      durationMs: Date.now() - startedAt,
      trace,
    },
  };
}
