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

## Normal Gates

| Suite                 | Result |
| --------------------- | -----: |
| typecheck:api         |    TBD |
| typecheck:knowledge   |    TBD |
| typecheck:web         |    TBD |
| typecheck:rlm-runtime |    TBD |
| eval:ci               |    TBD |
| eval:phase2           |    TBD |
| eval:phase3           |    TBD |
| eval:routing-intent   |    TBD |

## Manual Agent E2E

| Case                         | Result |
| ---------------------------- | ------ |
| 012-agent-executor-scaffold  | TBD    |
| 013-agent-executor-multistep | TBD    |
| SSE curl smoke               | TBD    |

## Notes

Normal routing remains unchanged when `AGENT_EXECUTOR_ENABLED=false`.
