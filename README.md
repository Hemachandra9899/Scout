<div align="center">

<pre align="center">
███████╗ ██████╗ ██████╗ ██╗   ██╗████████╗
██╔════╝██╔════╝██╔═══██╗██║   ██║╚══██╔══╝
███████╗██║     ██║   ██║██║   ██║   ██║   
╚════██║██║     ██║   ██║██║   ██║   ██║   
███████║╚██████╗╚██████╔╝╚██████╔╝   ██║   
╚══════╝ ╚═════╝ ╚═════╝  ╚═════╝    ╚═╝   
</pre>

**An evidence-first AI research engine with scoped memory, graph intelligence, and agent execution.**

Not a chatbot. Scout plans, searches, crawls, verifies, remembers useful context, reasons over graphs, executes safe tool workflows, and answers with evidence.

<br/>

[![Docker](https://img.shields.io/badge/docker-ready-2496ED?logo=docker\&logoColor=white\&style=flat-square)](https://docker.com)
[![TypeScript](https://img.shields.io/badge/typescript-5.x-3178C6?logo=typescript\&logoColor=white\&style=flat-square)](https://typescriptlang.org)
[![Next.js](https://img.shields.io/badge/next.js-15-black?logo=next.js\&logoColor=white\&style=flat-square)](https://nextjs.org)
[![FastAPI](https://img.shields.io/badge/fastapi-0.115-009688?logo=fastapi\&logoColor=white\&style=flat-square)](https://fastapi.tiangolo.com)
[![Qdrant](https://img.shields.io/badge/qdrant-ready-1A083E?logo=qdrant\&logoColor=white\&style=flat-square)](https://qdrant.tech)
[![Postgres](https://img.shields.io/badge/postgres-ready-4169E1?logo=postgresql\&logoColor=white\&style=flat-square)](https://postgresql.org)
[![Redis](https://img.shields.io/badge/redis-ready-DC382D?logo=redis\&logoColor=white\&style=flat-square)](https://redis.io)
[![BullMQ](https://img.shields.io/badge/bullmq-ready-28334C?logo=nodedotjs\&logoColor=white\&style=flat-square)](https://bullmq.io)
[![Fastify](https://img.shields.io/badge/fastify-ready-000000?logo=fastify\&logoColor=white\&style=flat-square)](https://fastify.io)
[![Prisma](https://img.shields.io/badge/prisma-ready-2D3748?logo=prisma\&logoColor=white\&style=flat-square)](https://prisma.io)
[![Status](https://img.shields.io/badge/status-active%20dev-7EE843?style=flat-square)](#roadmap)

</div>

---

## The Problem with Chatbots

Most AI assistants follow a simple loop:

```text
You ask → LLM answers
```

Fast. But fragile. The answer may sound confident while hiding uncertainty, missing sources, or using stale context.

**Scout is different.** Scout runs a full research and reasoning loop before it answers.

```text
You ask
  ↓
Scout routes the request
  ↓
Scout recalls relevant memory
  ↓
Scout searches trusted sources
  ↓
Scout crawls and extracts evidence
  ↓
Scout reranks useful evidence
  ↓
Scout verifies claims
  ↓
Scout synthesizes a grounded answer
  ↓
Scout stores useful memory for future runs
```

Scout is built around one principle:

> **Answers should be backed by evidence, not vibes.**

---

## What Scout Is

Scout is an AI research operating system.

It combines:

* evidence-first web research
* scoped memory
* source quality learning
* knowledge-base retrieval
* GitHub repository analysis
* repo graph construction
* graph report generation
* memory graph foundations
* safe Python sandbox execution
* worker-isolated runtime execution
* deterministic routing
* caching
* reranking
* agent executor workflows
* SSE progress streaming
* full eval harness

Scout is not trying to be a generic chatbot. It is designed to be a trustworthy research engine that can explain how it reached an answer.

---
## System Design

<div align="center">

<img
src="https://plain-apac-prod-public.komododecks.com/202606/29/vS7mNA0JSCVqPCCsqehb/image.png"
alt="Scout System Architecture"
width="100%"
/>

</div>

## Current Capabilities

| Capability                             | Status   |
| -------------------------------------- | -------- |
| Unified deterministic router           | Complete |
| Evidence-first web research            | Complete |
| Official-source seeded research        | Complete |
| Multi-provider search                  | Complete |
| Local/direct URL fetch fallback        | Complete |
| Bounded parallel research fan-out      | Complete |
| Focused retry after weak grounding     | Complete |
| Faithfulness critic                    | Complete |
| Scoped memory recall                   | Complete |
| Memory curator / sole writer           | Complete |
| Memory dedupe                          | Complete |
| Memory tiers                           | Complete |
| Memory relevance gating                | Complete |
| Source reuse memory                    | Complete |
| Blocked source memory                  | Complete |
| Knowledge-base retrieval               | Complete |
| GitHub repo analysis                   | Complete |
| Repo graph build/query                 | Complete |
| Incremental repo graph update          | Complete |
| Graph report generation                | Complete |
| Graph report export API/UI hooks       | Complete |
| Deterministic reranker                 | Complete |
| Evidence/memory/graph reranking        | Complete |
| Intermediate result caching            | Complete |
| Worker-isolated Python sandbox         | Complete |
| Model service health checks            | Complete |
| Agent executor scaffold                | Complete |
| Multi-step deterministic agent planner | Complete |
| Agent run API + SSE progress           | Complete |
| Reproducible Docker E2E stack          | Complete |
| Memory Graph app UI                    | Next     |
| Persistent agent runs                  | Later    |
| LLM planner behind strict schema       | Later    |
| Swarm / multi-agent orchestration      | Later    |

---

## How Scout Works

At a high level:

```text
User
  ↓
Web UI
  ↓
API Router
  ↓
Intent Classifier
  ↓
Memory Recall + Cache + Reranker
  ↓
Tool / Research / Graph / Agent / Sandbox Route
  ↓
Worker / Runtime / Model Service
  ↓
Evidence + Trace + Debug
  ↓
Final Answer
```

Scout has two execution modes:

1. **Synchronous route execution** for fast/direct paths.
2. **Queued worker execution** for background or long-running jobs.

---

## End-to-End Request Lifecycle

### 1. User submits a query

The user types a question in the frontend chat UI.

Example:

```text
Compare Google Ads API and Meta Marketing API authentication with citations.
```

The frontend sends a request to the API with:

```json
{
  "projectId": "a26d90b1-dc27-43de-a1dd-5c961d54ca0e",
  "userId": "optional-user-id",
  "query": "Compare Google Ads API and Meta Marketing API authentication with citations."
}
```

---

### 2. API validates and routes the query

The API calls the unified deterministic intent classifier:

```text
packages/knowledge/src/router/intent-classifier.ts
```

The classifier returns:

```ts
{
  intent,
  tier,
  route,
  tool,
  confidence,
  normalizedQuery,
  signals,
  analysisAngles,
  reason,
  source
}
```

Example:

```json
{
  "intent": "web_research",
  "tier": 2,
  "route": "research_orchestrator",
  "tool": "web_research",
  "confidence": 0.82,
  "signals": ["fresh_or_external_research"],
  "analysisAngles": [
    "Google Ads API authentication, permissions, rate limits, and docs",
    "Meta Marketing API authentication, permissions, rate limits, and docs"
  ],
  "reason": "Research/current/API/comparison query; use ResearchOrchestrator.",
  "source": "deterministic"
}
```

---

### 3. Scout decides whether memory is needed

Scout does not always recall memory.

Memory is skipped for pure code, pure sandbox, and pure graph routes when it is not needed.

Memory is used for:

* web research
* knowledge-base answers
* user preferences
* source quality
* blocked sources
* memoized repo follow-ups
* durable project context

This keeps latency low and avoids prompt pollution.

---

### 4. Scout checks cache

Scout caches expensive intermediate results, not final answers.

Cached surfaces:

```text
provider_search
url_fetch
official_source
graph_report
```

Scout does **not** cache final synthesized answers.

This means repeated research gets faster without freezing stale responses.

---

### 5. Scout gathers context and evidence

Depending on route, Scout may call:

* ResearchOrchestrator
* search_kb
* github_repo
* query_graph
* sandbox
* agent executor

For web research, Scout:

```text
plans subqueries
adds official source seeds
searches providers
ranks sources
fetches/crawls pages
extracts evidence
verifies citations
reranks evidence
synthesizes answer
runs critic
runs focused retry if needed
```

---

### 6. Worker path for async jobs

Long-running jobs can be queued.

```text
API creates job
  ↓
API pushes job to Redis/BullMQ
  ↓
Worker picks job
  ↓
Worker calls runtime/research/tool layer
  ↓
Worker saves report/message/result
  ↓
Frontend reads result/progress
```

This is how Scout supports heavier workflows without blocking the UI.

---

### 7. Final answer returns with debug

Scout responses include answer content plus trace/debug fields.

Typical debug includes:

```text
debug.routing
debug.memory
debug.memoryCurator
debug.cache
debug.rerank
debug.progress
debug.graph
debug.focusedRetry
debug.sandboxSafety
debug.agentExecutor
```

This makes Scout inspectable and eval-friendly.

---

## Routing System

Scout uses a tiered router.

### Tier 1 — Fast/direct routes

Used for obvious low-cost answers.

Examples:

* knowledge-base lookup
* uploaded document lookup
* pure code answer
* insufficient-evidence response
* simple deterministic response

```text
query → router → direct tool/model → answer
```

---

### Tier 2 — Research/tool routes

Used for external, current, API, comparison, and repo analysis questions.

Examples:

* web research
* GitHub repo analysis
* API docs comparison
* source-backed answer

```text
query → router → ResearchOrchestrator / GitHub tool → answer
```

---

### Tier 3 — Advanced routes

Used for graph, sandbox, and agent executor workflows.

Examples:

* query repo graph
* generate graph report
* run Python sandbox
* run explicit agent executor workflow

```text
query → router → graph / sandbox / agent executor → answer
```

---

## Research Engine v2

Scout's Research Engine v2 is the deterministic research backbone.

| Stage                 | Module                                 | Purpose                                                  |
| --------------------- | -------------------------------------- | -------------------------------------------------------- |
| Query planning        | `query-builder.ts` / planner utilities | Understand query and split into subqueries               |
| Source planning       | `resource-planner.ts`                  | Combine official seeds, providers, and memory hints      |
| Provider search       | `search-provider.ts`                   | Search Tavily/GitHub/local providers                     |
| Source ranking        | `source-ranker.ts`                     | Rank official, trusted, reference, and community sources |
| Memory-aware ranking  | `memory-ranking.ts`                    | Boost useful sources and penalize failed sources         |
| Crawling/fetching     | `crawl-manager.ts`, `local-fetch.ts`   | Fetch/crawl selected sources                             |
| Evidence extraction   | `evidence-extractor.ts`                | Convert page text into claim-level evidence              |
| Citation verification | `citation-verifier.ts`                 | Mark claims supported, weak, or unsupported              |
| Evidence packaging    | `evidence-pack.ts`                     | Package claims, citations, coverage, and gaps            |
| Reranking             | `packages/knowledge/src/rerank`        | Reorder evidence/memory/graph candidates                 |
| Answer synthesis      | `answer-synthesizer.ts`                | Build grounded Markdown answer                           |
| Faithfulness critic   | router/research critic path            | Detect unsupported or missing claims                     |
| Focused retry         | focused retry path                     | Recover only missing/weak evidence                       |

---

## Research Flow

```text
User query
  ↓
Intent classifier
  ↓
Memory policy
  ↓
Research plan
  ↓
Official source seeds
  ↓
Provider search
  ↓
Source ranking
  ↓
Bounded parallel crawl/fetch
  ↓
Evidence extraction
  ↓
Citation verification
  ↓
Evidence reranking
  ↓
Grounded answer synthesis
  ↓
Faithfulness critic
  ↓
Focused retry if needed
  ↓
Final answer
```

---

## Official Source Seeds

Scout injects official docs for known API/doc queries.

Examples:

| Query family               | Seed                |
| -------------------------- | ------------------- |
| Google Ads API             | Google Ads API docs |
| Meta Marketing API         | Meta developer docs |
| WhatsApp Business Platform | Meta WhatsApp docs  |
| GitHub REST API            | GitHub REST docs    |

This improves grounding when search providers return thin snippets or unreliable pages.

---

## Multi-provider Search

Scout can use multiple search/fetch providers.

| Provider      | Purpose                                |
| ------------- | -------------------------------------- |
| Tavily        | General web search                     |
| GitHub Search | Repo/source discovery                  |
| Local fetch   | Direct URL and official docs fallback  |
| Firecrawl     | Optional fallback, disabled by default |
| Brave         | Not used currently                     |

Relevant environment flags:

```bash
FIRECRAWL_ENABLED=false
TAVILY_ENABLED=true
GITHUB_SEARCH_ENABLED=true
LOCAL_CRAWL_ENABLED=true
BRAVE_SEARCH_ENABLED=false
```

Search providers are optional. Scout uses configured providers, deduplicates URLs, ranks sources, and falls back when providers fail.

---

## Focused Retry

Before M2.3, weak research answers could trigger a full second web research pass.

Now Scout uses focused retry.

```text
first research pass
  ↓
critic detects missing/weak evidence
  ↓
focused retry only for missing anchors
  ↓
small resource budget
  ↓
merge if improved
```

Debug fields:

```text
focusedRetryUsed
focusedRetryReason
focusedRetryAnchors
focusedRetryMaxResources
focusedRetryMs
focusedRetryImproved
focusedRetryOriginalScore
focusedRetryFinalScore
```

This reduces latency and provider cost.

---

## Memory System

Scout has a scoped, curated memory system.

Memory is not just a log. It changes future behavior.

Main source:

```text
packages/knowledge/src/memory/
```

---

### Memory Kinds

```text
preference
fact
durable_fact
source_quality
source_failure
decision
task_trace
```

---

### Memory Tiers

M4 introduced tiered memory.

```text
working
episodic
semantic
procedural
```

| Kind             | Tier       |
| ---------------- | ---------- |
| `preference`     | semantic   |
| `durable_fact`   | semantic   |
| `source_quality` | procedural |
| `source_failure` | procedural |
| `decision`       | episodic   |
| `task_trace`     | episodic   |

---

### Sole Writer Rule

Only the memory curator writes memories.

```text
MemoryManager.addMany()
  ↓
curateAndWriteMemories()
  ↓
Prisma memory write
```

This prevents random routes/tools from polluting memory.

---

### Memory Dedupe

Scout dedupes memories using a SHA-256 hash:

```text
projectId + userId + scope + kind + normalizedText + sourceUrls
```

This prevents duplicate memory rows from repeated runs.

---

### Durable Fact Safety

Durable facts require provenance.

If a memory is a durable fact but has no `sourceUrls`, the curator rejects it.

This prevents unsupported claims from becoming permanent memory.

---

### Memory Recall

Recall is relevance-gated.

```bash
MEMORY_RECALL_MIN_SCORE=0.2
MEMORY_RECALL_MAX_CONTEXT=8
```

Scout recalls memories for:

* source ranking
* preferences
* source reuse
* blocked source avoidance
* project decisions
* repo follow-ups
* KB/direct-model context

Memory is labeled as context, not evidence.

Scout does not cite memory as evidence unless source URLs are attached.

---

## Memory Upload

Scout supports the architecture for memory upload through the curator.

Expected flow:

```text
User uploads memory text
  ↓
API validates memory payload
  ↓
MemoryManager.addMany()
  ↓
Memory Curator
  ↓
dedupe + provenance checks + tier inference
  ↓
Postgres memory write
  ↓
UI shows written/skipped counts
```

Memory upload should never directly write Prisma memory rows.

---

## Memory Graph

Scout already has the backend foundation for memory graph views:

* memory kinds
* memory tiers
* scopes
* source URLs
* entities
* metadata
* curator versions

The dedicated Memory Graph UI is planned next.

Expected Memory Graph app:

```text
Memory nodes
  ↓
edges by shared entities / source URLs / kind / tier
  ↓
filters by tier, kind, scope, source-backed
  ↓
detail panel for selected memory
```

Memory Graph is separate from Repo Graph.

---

## Repo Graph System

Scout can analyze repositories and build a codebase graph.

Main source:

```text
packages/knowledge/src/graph/
```

Repo graph stores:

```text
Entity
Relation
Report
```

Examples of entities:

```text
file
service
module
function
class
package
runtime component
```

Examples of relations:

```text
imports
calls
depends_on
owns
uses_tool
routes_to
generates
```

---

### Repo Graph Flow

```text
GitHub repo URL
  ↓
repo analyzer fetches files
  ↓
repo graph builder extracts entities/relations
  ↓
Postgres stores Entity/Relation rows
  ↓
query_graph can answer architecture questions
  ↓
graph report generator creates GRAPH_REPORT.md
```

---

### Graph Report

Scout can generate repo graph reports with:

* repo overview
* key services
* important packages
* important files
* high-degree nodes
* relation type counts
* architecture paths
* suggested follow-up questions

Graph report export endpoints:

```text
GET /graph-reports/latest
GET /graph-reports/:reportId
GET /graph-reports/:reportId/download.md
```

---

## Reranker

M5 added a unified deterministic reranker.

Source:

```text
packages/knowledge/src/rerank/
```

Wired surfaces:

```text
evidence
memory
repo_graph
```

Current reranker uses:

```text
lexical overlap
base score
official/source quality boost
freshness boost
surface-specific boost
```

LLM reranker exists but is disabled by default:

```bash
RERANKER_LLM_ENABLED=false
```

This gives Scout a clean place to plug in future embedding or cross-encoder reranking.

---

## Cache System

M6 added intermediate result caching.

Source:

```text
packages/knowledge/src/cache/
```

Cached surfaces:

```text
provider_search
url_fetch
official_source
graph_report
```

Scout does **not** cache final answers.

This protects answer freshness while reducing repeated provider/fetch work.

Example cache debug:

```json
{
  "cacheEnabled": true,
  "searchCacheHit": true,
  "fetchCacheHit": false
}
```

Known limitation:

* current cache is in-memory
* cache resets on process restart
* Redis adapter can be added later

---

## Agent Executor

Scout has a typed, budgeted agent executor.

Source:

```text
packages/knowledge/src/agent/
```

Current agent design:

```text
single-agent
deterministic-first
budgeted
traceable
flag-gated
existing tools only
```

Default:

```bash
AGENT_EXECUTOR_ENABLED=false
```

---

### Agent Executor Flow

```text
Explicit agent query
  ↓
router checks AGENT_EXECUTOR_ENABLED
  ↓
deterministic planner builds AgentPlan
  ↓
executor validates budgets
  ↓
tool adapter runs steps
  ↓
trace events emitted
  ↓
result returned
```

---

### Multi-step Planning

M10 added deterministic multi-step planning.

Example query:

```text
Use agent executor to compare Google Ads API and Meta Marketing API authentication.
```

Plan:

```text
Step 1 → web_research Google Ads API
Step 2 → web_research Meta Marketing API
Step 3 → aggregate final answer
```

Current limits:

```bash
AGENT_EXECUTOR_MAX_STEPS=6
AGENT_EXECUTOR_MAX_TOOL_CALLS=10
AGENT_EXECUTOR_TIMEOUT_MS=180000
```

---

### Agent SSE Progress

M10 added SSE agent progress endpoints.

```text
POST /agents/runs
GET /agents/runs/:runId
GET /agents/runs/:runId/events
```

Progress events:

```text
agent_started
step_started
step_completed
step_failed
budget_exceeded
agent_completed
agent_failed
```

Current limitation:

* agent run store is in-memory
* persistent runs are planned later

---

## Sandbox Runtime

Scout uses an RLM runtime with Python sandbox execution.

Source:

```text
apps/rlm-runtime/
```

The sandbox can execute dynamic Python/tool code with budgets and isolation.

---

### M7 Sandbox Hardening

M7 added:

```text
SandboxBudget
SandboxSafetyDebug
stdout cap
stderr cap
tool-call budget
soft timeout
best-effort global isolation
```

Example safety debug:

```json
{
  "budget": {
    "timeoutMs": 30000,
    "maxStdoutChars": 20000,
    "maxStderrChars": 10000,
    "maxToolCalls": 12
  },
  "timedOut": false,
  "killed": false,
  "stdoutSize": 1234,
  "stderrSize": 0,
  "stdoutTruncated": false,
  "stderrTruncated": false,
  "toolCallCount": 3,
  "toolCallLimitHit": false,
  "isolationMode": "best_effort_globals"
}
```

---

### M8 Worker Isolation

M7 timeout was soft because in-process Pyodide could continue running after `Promise.race`.

M8 moved sandbox execution to a killable worker.

Default:

```bash
RLM_SANDBOX_ISOLATION_MODE=worker
```

Fallback:

```bash
RLM_SANDBOX_ISOLATION_MODE=in_process
```

Worker timeout behavior:

```text
parent starts worker
  ↓
worker runs Pyodide
  ↓
timeout occurs
  ↓
parent calls worker.terminate()
  ↓
safety.timedOut=true
  ↓
safety.killed=true
```

This gives Scout real termination semantics for CPU-bound Python.

---

## Model Service

Model service lives in:

```text
apps/model-service/
```

It is a FastAPI service for model calls and model-related utilities.

Current NVIDIA model setup:

```text
provider: NVIDIA
model: z-ai/glm-5.1
```

M9.5 fixed the ChatNVIDIA/pydantic compatibility issue.

Working versions:

```text
Python: 3.13.5
pydantic: 2.13.4
langchain-core: 0.3.86
langchain-nvidia-ai-endpoints: 0.3.19
```

Health endpoints:

```text
GET /health
GET /health/model
```

Expected:

```json
{
  "status": "ok",
  "provider": "nvidia",
  "model": "z-ai/glm-5.1"
}
```

---

## Queue and Worker System

Scout uses Redis and BullMQ for background execution.

Worker flow:

```text
API creates job
  ↓
job saved in Postgres
  ↓
job pushed to Redis/BullMQ
  ↓
worker picks job
  ↓
worker calls runtime/research/tool layer
  ↓
worker writes result/report/message
  ↓
frontend displays result
```

This supports long research jobs, report generation, and future async agent workflows.

---

## Full System Architecture

```text
apps/web
  ├── Chat UI
  ├── Research debug panels
  ├── Composer
  ├── Apps drawer
  ├── Graph report UI
  └── Future memory graph / agent progress UI

        ↓ HTTP

apps/api
  ├── Router
  ├── Tool routes
  ├── Memory routes
  ├── Graph report routes
  ├── Agent run routes
  ├── SSE progress endpoint
  └── Prisma access

        ↓ queue / direct call

Redis + BullMQ
  ├── job queue
  └── job state

        ↓

apps/worker
  ├── picks jobs
  ├── calls runtime/research
  └── saves results

        ↓

apps/rlm-runtime
  ├── RLM loop
  ├── worker-isolated Python sandbox
  ├── tool bridge
  └── answer critic

        ↓

apps/model-service
  ├── FastAPI
  ├── ChatNVIDIA
  └── model health checks

        ↓

packages/knowledge
  ├── research engine
  ├── memory curator
  ├── repo graph
  ├── cache
  ├── reranker
  ├── agent executor
  └── answer synthesis

        ↓

Storage
  ├── Postgres / Prisma
  ├── Qdrant
  └── Redis
```

---

## Architecture Table

| Layer           | Technology                      | Responsibility                                      |
| --------------- | ------------------------------- | --------------------------------------------------- |
| Frontend UI     | Next.js, Tailwind CSS           | Chat, debug panels, app shell, graph/report views   |
| Central API     | Fastify, TypeScript, Prisma     | Routing, tools, memory, graph reports, agent runs   |
| Worker          | Node.js, BullMQ                 | Background job execution                            |
| Runtime         | Deno/TypeScript, Pyodide Worker | Safe dynamic reasoning and sandboxed tool execution |
| Model Service   | FastAPI, ChatNVIDIA             | Model calls and model health                        |
| Research Engine | TypeScript                      | Search, crawl, evidence, synthesis, critic          |
| Memory System   | TypeScript + Postgres           | Scoped curated memory                               |
| Graph System    | TypeScript + Postgres           | Repo graph, entities, relations, graph reports      |
| Vector Store    | Qdrant                          | Semantic retrieval over documents                   |
| Database        | Postgres / Prisma               | Projects, jobs, reports, memories, graph            |
| Queue / Cache   | Redis                           | BullMQ jobs and async state                         |
| Cache Layer     | In-memory now, Redis later      | Intermediate provider/fetch/report caching          |

---

## Project Structure

```text
scout/
├── apps/
│   ├── api/                    # Fastify API, router, tools, graph, agent endpoints
│   ├── model-service/          # FastAPI + ChatNVIDIA/model utilities
│   ├── rlm-runtime/            # Worker-isolated sandbox/tool runtime
│   ├── web/                    # Next.js frontend
│   └── worker/                 # BullMQ worker
│
├── packages/
│   ├── knowledge/              # Research, memory, graph, rerank, cache, agents
│   ├── retrieval/              # Vector retrieval over documents
│   ├── database/               # Prisma/Postgres client
│   ├── clients/                # Shared clients
│   └── queue/                  # Queue helpers
│
├── harness/
│   └── eval/                   # Eval harness, phase cases, manual cases
│
├── harness-runs/               # Local eval outputs, gitignored
├── docs/                       # Architecture, planning, reports, testing
├── scripts/                    # DB setup, seeding, maintenance
├── docker-compose.yml
└── README.md
```

---

## Key Packages

### `packages/knowledge/src/research/`

Research pipeline.

```text
answer-mode.ts
answer-renderers.ts
answer-synthesizer.ts
citation-verifier.ts
crawl-manager.ts
evidence-extractor.ts
evidence-pack.ts
query-builder.ts
resource-planner.ts
search-provider.ts
source-ranker.ts
research-orchestrator.ts
```

---

### `packages/knowledge/src/memory/`

Curated memory system.

```text
memory-manager.ts
memory-types.ts
memory-curator.ts
```

---

### `packages/knowledge/src/graph/`

Repo graph and graph report logic.

```text
repo-graph-builder.ts
repo-graph-query.ts
repo-graph-report.ts
project-context-graph.ts
```

---

### `packages/knowledge/src/rerank/`

Deterministic reranking.

```text
reranker-types.ts
deterministic-reranker.ts
llm-reranker.ts
```

---

### `packages/knowledge/src/cache/`

Intermediate result caching.

```text
cache-types.ts
cache-key.ts
in-memory-cache.ts
cache-manager.ts
```

---

### `packages/knowledge/src/agent/`

Agent executor scaffold and deterministic planning.

```text
agent-types.ts
deterministic-planner.ts
agent-executor.ts
```

---

## Getting Started

### Prerequisites

* Docker + Docker Compose v2+
* Node.js
* npm
* Python only if running model-service locally outside Docker

---

### Start Full E2E Stack

```bash
npm run stack:up
```

Or manually:

```bash
docker compose up -d --build postgres redis qdrant model-service rlm-runtime api worker
```

---

### Check Services

```bash
docker compose ps
```

Health checks:

```bash
curl -s http://localhost:8000/health | jq .
curl -s http://localhost:8000/health/deps | jq .
curl -s http://localhost:8100/health | jq .
curl -s http://localhost:8100/health/model | jq .
curl -s http://localhost:6333/healthz || true
```

---

### Setup Database

```bash
./scripts/setup-e2e-db.sh
```

Seed eval project:

```bash
npm run db:seed:eval
```

Default eval project:

```text
a26d90b1-dc27-43de-a1dd-5c961d54ca0e
```

---

## Environment Variables

Core:

```bash
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/scout?schema=public
REDIS_URL=redis://redis:6379
QDRANT_URL=http://qdrant:6333
MODEL_SERVICE_URL=http://model-service:8100
```

Research/provider:

```bash
FIRECRAWL_ENABLED=false
TAVILY_ENABLED=true
GITHUB_SEARCH_ENABLED=true
LOCAL_CRAWL_ENABLED=true
BRAVE_SEARCH_ENABLED=false
```

Runtime:

```bash
RLM_SANDBOX_ISOLATION_MODE=worker
RLM_SANDBOX_TIMEOUT_MS=30000
RLM_SANDBOX_MAX_STDOUT_CHARS=20000
RLM_SANDBOX_MAX_STDERR_CHARS=10000
RLM_SANDBOX_MAX_TOOL_CALLS=12
```

Research performance:

```bash
RESEARCH_PARALLELISM=4
FOCUSED_RETRY_MAX_RESOURCES=4
FOCUSED_RETRY_TIMEOUT_MS=45000
```

Memory:

```bash
MEMORY_RECALL_MIN_SCORE=0.2
MEMORY_RECALL_MAX_CONTEXT=8
```

Cache:

```bash
SCOUT_CACHE_ENABLED=true
```

Reranker:

```bash
RERANKER_LLM_ENABLED=false
```

Router LLM classifier:

```bash
ROUTER_LLM_INTENT_ENABLED=false
```

Agent executor:

```bash
AGENT_EXECUTOR_ENABLED=false
AGENT_EXECUTOR_MAX_STEPS=6
AGENT_EXECUTOR_MAX_TOOL_CALLS=10
AGENT_EXECUTOR_TIMEOUT_MS=180000
AGENT_EXECUTOR_SSE_ENABLED=true
```

---

## Harness Commands

Run full CI eval:

```bash
npm run eval:ci
```

Run Phase 2 memory/context evals:

```bash
npm run eval:phase2
```

Run Phase 3 graph evals:

```bash
npm run eval:phase3
```

Run routing-intent evals:

```bash
npm run eval:routing-intent
```

Analyze latest run:

```bash
LATEST=$(ls -td harness-runs/* | head -1)
npm run eval:analyze -- "$LATEST"
cat "$LATEST/analysis.md"
```

---

## Standard Gate Command

```bash
npm run typecheck:api
npm run typecheck:knowledge
npm run typecheck:web

AGENT_EXECUTOR_ENABLED=false \
FIRECRAWL_ENABLED=false \
SCOUT_CACHE_ENABLED=true \
RESEARCH_PARALLELISM=4 \
FOCUSED_RETRY_MAX_RESOURCES=4 \
FOCUSED_RETRY_TIMEOUT_MS=45000 \
ROUTER_LLM_INTENT_ENABLED=false \
RERANKER_LLM_ENABLED=false \
MEMORY_RECALL_MIN_SCORE=0.2 \
MEMORY_RECALL_MAX_CONTEXT=8 \
RLM_SANDBOX_ISOLATION_MODE=worker \
npm run eval:ci

AGENT_EXECUTOR_ENABLED=false \
FIRECRAWL_ENABLED=false \
SCOUT_CACHE_ENABLED=true \
RESEARCH_PARALLELISM=4 \
FOCUSED_RETRY_MAX_RESOURCES=4 \
FOCUSED_RETRY_TIMEOUT_MS=45000 \
ROUTER_LLM_INTENT_ENABLED=false \
RERANKER_LLM_ENABLED=false \
MEMORY_RECALL_MIN_SCORE=0.2 \
MEMORY_RECALL_MAX_CONTEXT=8 \
RLM_SANDBOX_ISOLATION_MODE=worker \
npm run eval:phase2

AGENT_EXECUTOR_ENABLED=false \
FIRECRAWL_ENABLED=false \
SCOUT_CACHE_ENABLED=true \
RESEARCH_PARALLELISM=4 \
FOCUSED_RETRY_MAX_RESOURCES=4 \
FOCUSED_RETRY_TIMEOUT_MS=45000 \
ROUTER_LLM_INTENT_ENABLED=false \
RERANKER_LLM_ENABLED=false \
MEMORY_RECALL_MIN_SCORE=0.2 \
MEMORY_RECALL_MAX_CONTEXT=8 \
RLM_SANDBOX_ISOLATION_MODE=worker \
npm run eval:phase3

AGENT_EXECUTOR_ENABLED=false \
FIRECRAWL_ENABLED=false \
SCOUT_CACHE_ENABLED=true \
RESEARCH_PARALLELISM=4 \
FOCUSED_RETRY_MAX_RESOURCES=4 \
FOCUSED_RETRY_TIMEOUT_MS=45000 \
ROUTER_LLM_INTENT_ENABLED=false \
RERANKER_LLM_ENABLED=false \
MEMORY_RECALL_MIN_SCORE=0.2 \
MEMORY_RECALL_MAX_CONTEXT=8 \
RLM_SANDBOX_ISOLATION_MODE=worker \
npm run eval:routing-intent
```

---

## Web Research Smoke Test

```bash
curl -X POST http://localhost:8000/tools/web-research \
  -H "Content-Type: application/json" \
  -d '{
    "projectId":"a26d90b1-dc27-43de-a1dd-5c961d54ca0e",
    "query":"Compare Meta Marketing API and Google Ads API permissions and rate limits",
    "maxResults":5,
    "maxPagesPerSource":3,
    "maxTotalPages":12,
    "maxDepth":1,
    "useOrchestrator":true
  }'
```

Expected response includes:

```text
subqueries
resourcesPlanned
documents
failedCrawls
evidencePack
citationVerification
memories
answer.markdown
answer.citations
answer.confidence
```

---

## Agent Executor Smoke Test

Agent executor is disabled by default.

Enable it for manual tests:

```bash
AGENT_EXECUTOR_ENABLED=true
```

Run direct router test:

```bash
curl -s -X POST http://localhost:8000/router/answer \
  -H "Content-Type: application/json" \
  -d '{
    "projectId":"a26d90b1-dc27-43de-a1dd-5c961d54ca0e",
    "query":"Use agent executor to compare Google Ads API and Meta Marketing API authentication with citations."
  }' | jq '.debug.agentExecutor, .ui.agent'
```

Expected:

```text
agentExecutorUsed=true
stepCount >= 1
status completed or tool-level failure
```

---

## Agent SSE Smoke Test

Create run:

```bash
RUN_ID=$(curl -s -X POST http://localhost:8000/agents/runs \
  -H "Content-Type: application/json" \
  -d '{
    "projectId":"a26d90b1-dc27-43de-a1dd-5c961d54ca0e",
    "query":"Use agent executor to compare Google Ads API and Meta Marketing API authentication with citations."
  }' | jq -r '.runId')
```

Stream events:

```bash
curl -N "http://localhost:8000/agents/runs/$RUN_ID/events"
```

Expected events:

```text
agent_started
step_started
step_completed
agent_completed
```

---

## Graph Report Smoke Test

Fetch latest graph report:

```bash
curl "http://localhost:8000/graph-reports/latest?projectId=a26d90b1-dc27-43de-a1dd-5c961d54ca0e" | jq .
```

Download Markdown:

```bash
curl "http://localhost:8000/graph-reports/latest?projectId=a26d90b1-dc27-43de-a1dd-5c961d54ca0e&format=md" \
  -o GRAPH_REPORT.md

head -40 GRAPH_REPORT.md
```

---

## Example Research Output Shape

```json
{
  "status": "ok",
  "query": "Compare Meta Marketing API and Google Ads API permissions and rate limits",
  "subqueries": [
    {
      "query": "Meta Marketing API permissions",
      "reason": "Find source-specific permission details",
      "priority": 1
    }
  ],
  "resourcesPlanned": [
    {
      "title": "Meta Marketing API Documentation",
      "url": "https://developers.facebook.com/docs/marketing-apis/",
      "tier": "official_docs",
      "score": 128,
      "matchedBy": ["registry", "memory:source_quality:+16"]
    }
  ],
  "evidencePack": {
    "coverage": {
      "hasEvidence": true,
      "claimCount": 14,
      "supportedClaimCount": 11,
      "weakClaimCount": 3,
      "unsupportedClaimCount": 2
    }
  },
  "answer": {
    "mode": "comparison",
    "status": "answered",
    "confidence": 0.91,
    "markdown": "## Answer\n\n...",
    "citations": [
      {
        "id": 1,
        "title": "Meta Marketing API Documentation",
        "url": "https://developers.facebook.com/docs/marketing-apis/",
        "tier": "official_docs",
        "usedClaims": 4
      }
    ]
  }
}
```

Unsupported claims are never used in final answer synthesis.

---

## Problems We Faced and Fixed

### Provider instability

Problem:

```text
Firecrawl/provider instability caused grounding and reliability failures.
```

Fix:

```text
Firecrawl optional/off
Tavily/GitHub/local fetch fallback
official source seeds
provider debug
focused recovery
```

---

### DB foreign-key crashes

Problem:

```text
Memory/report writes failed when eval project rows were missing.
```

Fix:

```text
project upsert/seed
M9.6 reproducible E2E stack
DB setup script
eval project seed script
```

---

### Memory pollution

Problem:

```text
Old global memories leaked across evals and polluted answers.
```

Fix:

```text
scoped memory recall
project/user isolation
memory curator
dedupe
relevance gate
```

---

### Weak answer grounding

Problem:

```text
Answers sometimes included weak or unsupported claims.
```

Fix:

```text
evidence verification
faithfulness critic
focused retry
unsupported claim omission
```

---

### Graph query missing important nodes

Problem:

```text
Important files like worker/runtime nodes got buried by UUID order and result limits.
```

Fix:

```text
larger DB take limits
stopword cleanup
token-aware sorting
file bonus
deterministic tie-breaking
```

---

### Slow research

Problem:

```text
Subquery/provider/fetch loops were too serial.
```

Fix:

```text
bounded concurrency
RESEARCH_PARALLELISM=4
caching
focused retry
```

---

### Scattered routing

Problem:

```text
Intent routing lived in multiple places.
```

Fix:

```text
unified deterministic intent classifier
debug.routing everywhere
optional LLM classifier disabled
```

---

### Unsafe sandbox

Problem:

```text
Pyodide could run forever, print forever, call tools forever, and leak state.
```

Fix:

```text
sandbox budgets
stdout/stderr caps
tool-call budget
worker isolation
worker.terminate() hard kill
```

---

### Model-service dependency crash

Problem:

```text
ChatNVIDIA/pydantic compatibility error blocked E2E model service.
```

Fix:

```text
aligned pydantic/langchain-core/langchain-nvidia-ai-endpoints versions
added /health/model
added startup self-test
```

---

### E2E stack not reproducible

Problem:

```text
Agent/manual tests needed Postgres, Redis, Qdrant, model-service, API, runtime, and worker all healthy.
```

Fix:

```text
Docker compose stack
setup-e2e-db.sh
seed-eval-project.mjs
M9.6 baseline
health checks
```

---

## Development Principles

* Keep route handlers thin.
* Keep modules small and single-purpose.
* Prefer deterministic stages before LLM polish.
* Do not let final answers introduce unsupported facts.
* Memory should guide behavior, not become hidden evidence.
* Every answer should be traceable back to evidence.
* Every new feature must expose debug signals.
* Every milestone must keep eval gates green.
* Avoid swarms until the single-agent path is stable.
* Prefer typed contracts and explicit budgets.
* Expensive work should be cached or queued.
* Unsafe runtime execution must be isolated and killable.

---

## Roadmap

### Complete

* [x] Tiered router
* [x] Unified deterministic intent classifier
* [x] Evidence-first ResearchOrchestrator
* [x] Source relevance gate
* [x] News/API/comparison query handling
* [x] Faithfulness critic
* [x] Harness with reward + trajectories
* [x] CI eval gate
* [x] Scoped memory recall
* [x] Blocked source memory
* [x] Source reuse
* [x] Bounded evidence recovery
* [x] Focused retry
* [x] Bounded parallelization
* [x] Lazy memory recall
* [x] Progress event scaffold
* [x] Memory curator
* [x] Memory dedupe
* [x] Memory tiers
* [x] Relevance-gated memory recall
* [x] Repo graph builder
* [x] Repo graph query
* [x] Incremental graph update
* [x] Graph report generation
* [x] Graph report export API
* [x] Deterministic reranker
* [x] Evidence/memory/graph reranking
* [x] Intermediate result caching
* [x] Sandbox budgets
* [x] Worker-isolated sandbox
* [x] Model-service NVIDIA compatibility fix
* [x] Agent executor scaffold
* [x] Multi-step deterministic agent planner
* [x] Agent run API
* [x] Agent SSE progress endpoint
* [x] Reproducible E2E eval stack

---

### Next

* [ ] Composer plus menu
* [ ] Document upload UI
* [ ] Memory upload UI
* [ ] Apps drawer
* [ ] Memory Graph app
* [ ] Repo Graph app
* [ ] Agent Runs UI
* [ ] Settings modal
* [ ] Account menus

---

### Later

* [ ] Persistent agent runs
* [ ] Agent progress UI polish
* [ ] LLM planner behind strict schema
* [ ] Redis cache adapter
* [ ] True semantic/cross-encoder reranker
* [ ] Memory graph layout polish
* [ ] Parallel agent step execution
* [ ] MCP/connectors with safety rules
* [ ] Swarm/multi-agent orchestration
* [ ] Self-learning loop after eval coverage

---

## Project Status

Scout is in **active development**.

Current foundation is stable:

```text
router
research
memory
graph
cache
rerank
sandbox
model-service
agent executor
E2E stack
```

Next product milestone is the UI layer:

```text
ChatGPT-like shell
Apps section
Memory Graph
Document upload
Memory upload
Agent progress
Settings
```

The backend can already think deeply. The next step is making it feel like a polished product.

---

<div align="center">

Built to think deeper. Research further. Answer with evidence.

</div>
