<div align="center">

```
███████╗ ██████╗ ██████╗ ██╗   ██╗████████╗
██╔════╝██╔════╝██╔═══██╗██║   ██║╚══██╔══╝
███████╗██║     ██║   ██║██║   ██║   ██║   
╚════██║██║     ██║   ██║██║   ██║   ██║   
███████║╚██████╗╚██████╔╝╚██████╔╝   ██║   
╚══════╝ ╚═════╝ ╚═════╝  ╚═════╝    ╚═╝   
```

**An evidence-first AI research engine with scoped memory.**

Not a chatbot. Scout plans, searches, crawls, verifies, remembers useful context, and answers with evidence.

<br/>

[![Docker](https://img.shields.io/badge/docker-ready-2496ED?logo=docker&logoColor=white&style=flat-square)](https://docker.com)
[![TypeScript](https://img.shields.io/badge/typescript-5.x-3178C6?logo=typescript&logoColor=white&style=flat-square)](https://typescriptlang.org)
[![Next.js](https://img.shields.io/badge/next.js-15-black?logo=next.js&logoColor=white&style=flat-square)](https://nextjs.org)
[![FastAPI](https://img.shields.io/badge/fastapi-0.115-009688?logo=fastapi&logoColor=white&style=flat-square)](https://fastapi.tiangolo.com)
[![Qdrant](https://img.shields.io/badge/qdrant-ready-1A083E?logo=qdrant&logoColor=white&style=flat-square)](https://qdrant.tech)
[![Supabase](https://img.shields.io/badge/supabase-ready-3ECF8E?logo=supabase&logoColor=white&style=flat-square)](https://supabase.com)
[![Redis](https://img.shields.io/badge/redis-ready-DC382D?logo=redis&logoColor=white&style=flat-square)](https://redis.io)
[![BullMQ](https://img.shields.io/badge/bullmq-ready-28334C?logo=nodedotjs&logoColor=white&style=flat-square)](https://bullmq.io)
[![Fastify](https://img.shields.io/badge/fastify-ready-000000?logo=fastify&logoColor=white&style=flat-square)](https://fastify.io)
[![Prisma](https://img.shields.io/badge/prisma-ready-2D3748?logo=prisma&logoColor=white&style=flat-square)](https://prisma.io)
[![Status](https://img.shields.io/badge/status-active%20dev-7EE843?style=flat-square)](#roadmap)
</div>

---

## The Problem with Chatbots

Most AI assistants follow a simple loop:

```
You ask → LLM answers
```

Fast. But fragile. Sounds confident. Hides uncertainty. Rarely shows where the answer came from.

**Scout is different.** It runs a full research loop before it answers.

---

## How Scout Thinks

```
You ask a question
        │
        ▼
  Intent + Query Planning
        │
        ▼
  Multi-query Source Discovery
        │
        ▼
  Memory-aware Source Ranking
        │
        ▼
  Bounded Web Crawl · Scrapling
        │
        ▼
  Clean Markdown Extraction
        │
        ▼
  Vector Ingestion + Chunking
        │
        ▼
  Claim-level Evidence Extraction
        │
        ▼
  Citation Verification
        │
        ▼
  Durable Memory Writes
        │
        ▼
  Evidence-based Answer Synthesis
```

Scout does not just generate. It researches, indexes, verifies, remembers — and then answers.

---

## Current Capabilities

| Capability | Status |
|---|---|
| Tiered router | Complete |
| Evidence-first web research | Complete |
| GitHub repo analysis | Complete |
| Knowledge-base retrieval | Complete |
| Faithfulness critic | Complete |
| Eval harness + CI gate | Complete |
| Scoped memory recall | Complete |
| Blocked source memory | Complete |
| Source reuse | Complete |
| Bounded evidence recovery | Complete |
| Graph context | Complete |
| MCP/connectors | Later |
| Recursion/self-healing | Later |

---

## Research Engine v2

Scout's Research Engine v2 adds a deterministic research backbone.

> **Answers should be backed by evidence, not vibes.**

| Stage | Module | Purpose |
|---|---|---|
| **Search Planning** | `SearchPlannerAgent` | Understand query, infer intent, generate subqueries |
| **Source Planning** | `planResources()` | Combine registry sources and web search candidates |
| **Source Ranking** | `rankResourceCandidates()` | Rank official, trusted, community, and reference sources |
| **Memory-aware Ranking** | `memory-ranking.ts` | Boost useful sources, penalize failed sources |
| **Deep Crawl** | `crawl-manager.ts` + Scrapling | Crawl bounded same-domain pages, convert to Markdown |
| **Evidence Extraction** | `evidence-extractor.ts` | Convert Markdown into claim-level evidence |
| **Citation Verification** | `citation-verifier.ts` | Mark claims as `supported`, `weak`, or `unsupported` |
| **Evidence Pack** | `evidence-pack.ts` | Package evidence, citations, coverage, and gaps |
| **Memory** | `MemoryManager` + `MemoryAgent` | Store useful sources, failed crawls, and durable facts |
| **Answer Synthesis** | `answer-synthesizer.ts` | Build grounded Markdown answers from verified evidence |
| **Answer Modes** | `answer-mode.ts`, `answer-renderers.ts` | Format as comparison, how-to, summary, or general |

---

## Answer Modes

Scout formats answers based on the user's intent.

| Mode | Trigger Examples | Output |
|---|---|---|
| `comparison` | "compare A and B", "A vs B", "differences" | Comparison table + key takeaways + evidence notes |
| `how_to` | "how to", "fix", "debug", "implement", "setup" | Steps + implementation notes + verification checklist |
| `research_summary` | "overview", "summarize", "what is", "deep dive" | Main points + evidence notes + sources |
| `general` | Fallback | Grounded answer with numbered citations |

**Example response shape:**

```json
{
  "answer": {
    "mode": "comparison",
    "status": "answered",
    "markdown": "...",
    "citations": [],
    "usedEvidenceCount": 10,
    "supportedEvidenceCount": 8,
    "weakEvidenceCount": 2,
    "omittedUnsupportedCount": 4,
    "confidence": 0.91
  }
}
```

Unsupported claims are never used in final answer synthesis.

---

## Memory System

Scout uses **add-only memory.** It does not overwrite past memories. It writes new entries with scope, kind, source URLs, entities, metadata, and confidence.

**Memory kinds:**

```
preference      fact      durable_fact
source_quality  source_failure
decision        task_trace
```

**Before research** — Scout retrieves relevant memories for source ranking:

```
source_quality  → boost useful sources
source_failure  → penalize repeatedly failing URLs/domains
durable_fact    → lightly boost related sources/entities
```

**After research** — Scout writes new memories from the run:

```
supported evidence → durable_fact
useful sources     → source_quality
failed crawls      → source_failure
```

This lets Scout improve across runs without hiding the evidence trail.

### Scoped Memory Recall

Phase 2.1 adds scoped memory recall to the router path.

Scout can now:

```text
- write explicit user preferences from setup/user messages
- write blocked/untrusted source memories
- recall relevant user/project/source memories before answering
- inject memory into KB/direct-model prompts safely
- avoid leaking unrelated user memories into other runs
- expose debug.memory signals for the harness
```

Debug signals:

```text
recallUsed
recalledCount
recalledKinds
blockedSourceAvoided
sourceReuseUsed
setupWritten
recoveryAttempted
graphContextUsed
```

Memory isolation:

```text
with userId    → user memories + global memories
without userId → only global memories
```

Memory is not treated as evidence unless it is backed by durable facts/citations.

---

## Architecture

| Layer | Technology | Responsibility |
|---|---|---|
| **Frontend UI** | Next.js, Tailwind CSS | Research chat, job state, answer display, source drawers |
| **Central API** | Fastify, TypeScript, Prisma | Projects, tool routes, jobs, documents, orchestration |
| **Worker** | Node.js, BullMQ | Background research execution |
| **Runtime** | Pyodide / sandboxed execution | Safe dynamic reasoning and tool calls |
| **Model Service** | FastAPI, Scrapling, Playwright | Crawling, scraping, Markdown extraction, model utilities |
| **Vector Store** | Qdrant | Semantic retrieval over project documents |
| **Database** | Postgres / Supabase | Projects, jobs, documents, chunks, memories, reports |
| **Queue / Cache** | Redis | Async jobs and status tracking |
| **Knowledge Package** | TypeScript | Research pipeline, evidence, memory, answer synthesis |

---

## Project Structure

```
scout/
├── apps/
│   ├── api/                    # Fastify API, router, tools, critic
│   ├── model-service/          # FastAPI + Scrapling/model utilities
│   ├── rlm-runtime/            # Sandbox/tool runtime
│   ├── web/                    # Next.js frontend
│   └── worker/                 # BullMQ worker
│
├── packages/
│   ├── knowledge/              # Research engine, memory, evidence, synthesis
│   ├── retrieval/              # Vector retrieval over project documents
│   ├── database/               # Prisma/Postgres client
│   ├── clients/                # Shared clients
│   └── queue/                  # Queue helpers
│
├── harness/
│   └── eval/                   # Phase 1 and Phase 2 eval harness
│
├── harness-runs/               # Local eval outputs, gitignored
├── docs/                       # Architecture, harness, phase summaries
├── scripts/                    # Maintenance and cleanup scripts
├── prisma/
│   └── schema.prisma
└── README.md
```

---

## Key Packages

### `packages/knowledge/src/research/`

Core research pipeline.

```
answer-mode.ts          answer-renderers.ts     answer-synthesizer.ts
citation-verifier.ts    crawl-manager.ts        evidence-extractor.ts
evidence-pack.ts        memory-ranking.ts       query-builder.ts
resource-planner.ts     search-provider.ts      source-ranker.ts
source-types.ts         research-orchestrator.ts
```

### `packages/knowledge/src/agents/`

Small deterministic agents.

```
search-planner.agent.ts     memory-agent.ts     types.ts
```

### `packages/knowledge/src/memory/`

Add-only memory layer.

```
memory-manager.ts     memory-types.ts
```

### `packages/knowledge/src/graph/`

Deterministic project entity graph for architecture/component queries.

```
project-context-graph.ts
```

---

## Getting Started

### Prerequisites

- Docker + Docker Compose v2+
- Node.js
- npm

### Start the stack

```bash
docker compose build
docker compose up
```

Or use the helper script:

```bash
chmod +x ./run.sh
./run.sh
```

### Generate Prisma client

```bash
npm run prisma:generate
```

---

## Harness Commands

Run Phase 1 eval:

```bash
npm run eval
```

Run CI gate:

```bash
npm run eval:ci
```

Run Phase 2 memory/context evals:

```bash
npm run eval:phase2
```

Analyze a run:

```bash
LATEST=$(ls -td harness-runs/* | head -1)
npm run eval:analyze -- "$LATEST"
cat "$LATEST/analysis.md"
```

Clear harness memory for an eval project:

```bash
EVAL_PROJECT_ID=<PROJECT_ID> node scripts/clear-harness-memory.mjs
```

---

## Web Research Smoke Test

Create or use a valid `projectId`, then run:

```bash
curl -X POST http://localhost:8000/tools/web-research \
  -H "Content-Type: application/json" \
  -d '{
    "projectId":"<PROJECT_ID>",
    "query":"Compare Meta Marketing API and Google Ads API permissions and rate limits",
    "maxResults":5,
    "maxPagesPerSource":3,
    "maxTotalPages":12,
    "maxDepth":1,
    "useOrchestrator":true
  }'
```

**Expected response fields:**

```
subqueries                  resourcesPlanned
documents                   failedCrawls
evidencePack                evidencePack.evidence
evidencePack.citationVerification
memories.retrieved          memories.usedForRanking
memories.written            answer.mode
answer.markdown             answer.citations
answer.confidence
```

---

## Example Output Shape

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

---

## Development Principles

- Keep route handlers thin.
- Keep modules small and single-purpose.
- Prefer deterministic stages before LLM polish.
- Do not let final answers introduce unsupported facts.
- Apply DRY: shared rendering logic belongs in renderer utilities.
- Avoid deeply nested functions.
- Avoid large swarms until the research pipeline is stable.
- Memory should change future behavior, not just store logs.
- Every answer should be traceable back to evidence.

---


**Currently not adopted:**

```
large agent swarms           consensus algorithms
GraphAgent                   unconstrained LLM answer polish
private workspace connectors
```

---

---

## Multi-provider search

Scout can search through multiple providers when API keys are configured:

```text
FIRECRAWL_API_KEY
TAVILY_API_KEY
GITHUB_TOKEN
```

Provider behavior:

| Provider | Used for |
| --- | --- |
| Firecrawl | Existing general web search fallback |
| Tavily | Main web search provider |
| GitHub | Repository discovery for SDKs, clients, examples, and implementation references |

Brave Search is intentionally not used for now.

Search providers are optional. Scout uses whatever is configured and deduplicates URLs across providers before ranking.

## Roadmap

### Complete

- [x] Tiered router
- [x] Evidence-first ResearchOrchestrator
- [x] Source relevance gate
- [x] News/API/comparison query handling
- [x] Faithfulness critic
- [x] Harness v2 with reward + trajectories
- [x] CI eval gate
- [x] Scoped memory recall
- [x] Blocked source memory

### Complete

- [x] Scoped memory recall
- [x] Blocked source memory
- [x] Source reuse from prior research
- [x] Expose `sourceReuseUsed=true`
- [x] Bounded evidence recovery
- [x] Expose `recoveryAttempted=true`
- [x] Add targeted recovery eval pass
- [x] Lightweight project/entity graph
- [x] Expose `graphContextUsed=true`
- [x] Add Phase 2.4 targeted eval pass
- [x] Memo Repo / Remember Repo memory
- [x] Expose `memoRepoUsed=true`
- [x] Add Phase 2.5 targeted eval passes

### Next: Phase 3

- [ ] Graphify/Graphiti-style repo graph

### Later

- [ ] MCP/connectors with safety rules
- [ ] Recursion only after eval proves the need

---

## Project Status

Scout is in **active development.**

The current branch focuses on Research Engine v2:

```
planning            source ranking          memory-aware retrieval
Scrapling crawl     evidence extraction     citation verification
answer synthesis    answer modes
```

The deterministic research pipeline is the foundation. Graph agents, swarms, and LLM polish come later.

---

<div align="center">

Built to think deeper. Research further. Answer with evidence.

</div>

---

## Provider smoke tests

Provider smoke tests call real external APIs and are skipped by default.

Run Tavily only:

```bash
RUN_PROVIDER_SMOKE=1 TAVILY_API_KEY=... npm run test:providers
```

Run GitHub only:

```bash
RUN_PROVIDER_SMOKE=1 GITHUB_TOKEN=... npm run test:providers
```

Run Firecrawl + Tavily:

```bash
RUN_PROVIDER_SMOKE=1 FIRECRAWL_API_KEY=... TAVILY_API_KEY=... npm run test:providers
```

Brave is intentionally not used.

---

## Frontend research debug panels

The web app can render the `research-response-v1` contract from completed jobs.

Debug tabs:

```text
Summary
Sources
Crawl
Evidence
Grounding
Raw
```

The UI prefers:

```text
ui.answerMarkdown
ui.citations
ui.evidenceCoverage
ui.crawlTrace
ui.groundingStatus
```

when a contract is available, while preserving legacy report rendering as fallback.

---

## Benchmark query suite

Scout includes a fixed research benchmark suite.

Run after Docker is up:

```bash
API_BASE_URL=http://localhost:8000 \
BENCHMARK_PROJECT_ID=test-project \
npm run benchmark:research
```

Quick smoke:

```bash
BENCHMARK_MAX_QUERIES=3 npm run benchmark:research
```

Outputs are written to:

```text
harness-runs/<timestamp>/
```

The runner validates:

```text
contractVersion
grounding status
citation count
accepted crawl pages
filtered evidence count
```
