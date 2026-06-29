# M9 — Agent Executor Scaffold Baseline

## Status

| Check | Status |
|---|---|
| C1 Types | Done |
| C2 Deterministic Planner | Done |
| C3 Budgeted Executor | Done |
| C4 Router Wiring (answerWithRouter) | Done |
| C5 Harness Signals + Eval Case | Done |
| C6 Baseline Doc | Done |

## Files Changed

- `packages/knowledge/src/agent/agent-types.ts` — AgentToolName, AgentPlan, AgentStep, AgentStepResult, AgentExecutorBudget, AgentExecutorTraceEvent, AgentExecutorResult
- `packages/knowledge/src/agent/deterministic-planner.ts` — `buildDeterministicAgentPlan()` produces a sequential tool plan
- `packages/knowledge/src/agent/agent-executor.ts` — `executeAgentPlan()` runs plan steps with budget enforcement and trace events
- `packages/knowledge/src/agent/index.ts` — barrel export
- `packages/knowledge/package.json` — exports for `./agent` and `./agent/*`
- `apps/api/src/modules/router/router.service.ts` — imports agent executor, helper functions (`agentExecutorEnabled`, `looksLikeAgentExecutorRequest`, `getAgentExecutorBudget`, `executeAgentTool`), guarded branch in `answerWithRouter`
- `harness/eval/run-eval.mjs` — agentExecutorUsed, agentStepCount, agentStatus signals
- `harness/eval/harness-trajectory.mjs` — same signals
- `harness/eval/analyze-run.mjs` — agentExecutorUsed count
- `harness/eval/manual-cases/012-agent-executor-scaffold.json` — manual eval case

## Env Vars

| Var | Default | Purpose |
|---|---|---|
| `AGENT_EXECUTOR_ENABLED` | `false` | Enables agent executor branch in router |
| `AGENT_EXECUTOR_MAX_STEPS` | `5` | Max sequential steps |
| `AGENT_EXECUTOR_MAX_TOOL_CALLS` | `8` | Max total tool invocations across all steps |
| `AGENT_EXECUTOR_TIMEOUT_MS` | `120000` | Total timeout across all steps |

## Agent Executor Design

1. `buildDeterministicAgentPlan()` maps the query to a static `AgentToolName[]` plan based on keywords
2. `executeAgentPlan()` runs steps sequentially:
   - Each step receives the original query as input
   - Tool output is appended to a conversation transcript
   - Budget (`maxSteps`, `maxToolCalls`, `timeoutMs`) is checked before each step
   - Trace events record start/finish/error/budget per step
3. `executeAgentTool()` in router.service.ts bridges `AgentToolName` to the existing tool service functions
4. `looksLikeAgentExecutorRequest()` guards on trigger keywords (`"use agent executor"`, `"agent mode"`, etc.)

## Harness Signals

All three harness files extract:
- `agentExecutorUsed` (boolean) — whether the agent executor was triggered
- `agentStepCount` (number) — how many steps the executor ran
- `agentStatus` (string|null) — "completed", "failed", or "budget_exceeded"

## Gate Verification

All five typechecks pass with AGENT_EXECUTOR_ENABLED=false:
- apps/api: ✅
- packages/knowledge: ✅
- apps/web: ✅

## Limitations / Known Issues

- Sandbox tool execution through AgentExecutor is deferred (throws runtime error)
- Only sequential, deterministic planning; no dynamic re-planning based on tool outputs
- Trigger keywords are hardcoded; must match exactly
- No LLM-based plan generation (deterministic only)
- `AGENT_EXECUTOR_ENABLED=false` by default — no impact on normal evals
