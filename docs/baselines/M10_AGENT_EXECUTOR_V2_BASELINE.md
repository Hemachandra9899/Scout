# M10 Agent Executor v2 Baseline

## Goal

Add deterministic multi-step planning and SSE progress for the agent executor.

## Scope

M10 is:
- single-agent
- deterministic-first
- budgeted
- traceable
- SSE-capable

M10 is not:
- swarm
- autonomous long-horizon planning
- MCP/Ruflo
- self-learning

## Added

- Multi-step deterministic planner
- Agent progress sink
- In-memory agent run store
- `/agents/runs`
- `/agents/runs/:runId`
- `/agents/runs/:runId/events`
- Shared agent tool adapter
- Manual multi-step eval case

## Env

```bash
AGENT_EXECUTOR_ENABLED=false
AGENT_EXECUTOR_MAX_STEPS=6
AGENT_EXECUTOR_MAX_TOOL_CALLS=10
AGENT_EXECUTOR_TIMEOUT_MS=180000
AGENT_EXECUTOR_SSE_ENABLED=true
```

## Normal Gates (AGENT_EXECUTOR_ENABLED=false)

| Suite                 | Result |
| --------------------- | -----: |
| typecheck:api         |  PASS  |
| typecheck:knowledge   |  PASS  |
| typecheck:web         |  PASS  |
| eval:ci               |  10/10 |
| eval:phase2           |  6/7 (known memo-repo latency flake) |
| eval:phase3           |  8/8   |
| eval:routing-intent   | 17/17  |

## Manual Agent E2E

| Case                         | Result |
| ---------------------------- | ------ |
| 012-agent-executor-scaffold  | TBD    |
| 013-agent-executor-multistep | TBD    |
| SSE curl smoke               | TBD    |

## Notes

Normal routing remains unchanged when `AGENT_EXECUTOR_ENABLED=false`.
