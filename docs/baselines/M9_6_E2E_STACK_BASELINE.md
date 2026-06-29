# M9.6 — Reproducible E2E Eval Stack

## Problem

The full local eval stack (postgres, redis, qdrant, model-service, rlm-runtime, api, worker) was not reproducible:

- No PostgreSQL in `docker-compose.yml` — API/worker had no local database
- No `DATABASE_URL` passed to API/worker containers
- No DB setup or seed scripts
- `.env.example` had conflicting/incomplete defaults
- `DATABASE_URL` in `.env` referenced `localhost` (host-only) with wrong user, breaking Docker containers

## Changes

### docker-compose.yml
- Added `postgres` service (`postgres:16-alpine`) with healthcheck and persistent volume
- Hardcoded `DATABASE_URL` / `DIRECT_URL` (container hostnames) for `api` and `worker`
- Hardcoded `REDIS_URL`, `QDRANT_URL`, `MODEL_SERVICE_URL`, `RLM_RUNTIME_URL` (container hostnames)
- Added `AGENT_EXECUTOR_ENABLED=true` to API environment

### .env.example
- Cleaned up: Docker stack defaults vs local dev sections
- Added `AGENT_EXECUTOR_ENABLED`, `POSTGRES_*`, etc.

### Scripts
- `scripts/setup-e2e-db.sh` — Prisma generate + migrate/push + seed
- `scripts/seed-eval-project.mjs` — upserts eval project `a26d90b1-dc27-43de-a1dd-5c961d54ca0e`

### package.json scripts
- `db:generate`, `db:migrate`, `db:push`, `db:seed:eval`, `db:setup`
- `stack:up`, `stack:logs`, `stack:down`, `stack:reset`

### Eval harness
- `extractActualTool()` now checks `response.ui.agent.steps` before falling through to `response.route.tool` — makes agent executor routing visible to eval harness

## Verification

### Health checks
```
GET /health        → {"status":"ok","service":"api"}
GET /health/deps   → {"postgres":"ok","redis":"ok","qdrant":"ok","rlmRuntime":"ok"}
GET /health (model) → {"status":"ok","provider":"nvidia","model":"z-ai/glm-5.1"}
```

### Normal gates (AGENT_EXECUTOR_ENABLED=false)
| Gate | Result |
|------|--------|
| eval:ci | 10/10 PASS (reward 6.0, routing 100%) |
| eval:phase2 | 6/7 PASS (1 expected fresh-DB failure) |
| eval:phase3 | 8/8 PASS (reward 6.0, routing 100%) |
| eval:routing-intent | 17/17 PASS (reward 6.0, routing 100%) |

### Agent Executor E2E (AGENT_EXECUTOR_ENABLED=true)
| Case | Result |
|------|--------|
| agent-executor-scaffold-001 | PASS (reward 6.0, agentExecutorUsed=true) |
