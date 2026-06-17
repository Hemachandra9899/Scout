# Scout Architecture

Scout is an evidence-first AI research engine. It routes each query to the cheapest reliable path, retrieves or researches the needed context, verifies grounding, and returns an answer with traceable evidence.

## Current Status

| Area | Status |
|---|---|
| Phase 1 router + critic + harness | Complete |
| Phase 1 eval | 10/10 |
| Routing accuracy | 100% |
| Mean reward | 6.0 |
| Phase 2.1 scoped memory recall | Complete |
| Phase 2.1 targeted eval | 2/2 |
| Memory signals | `recallUsed=true`, `blockedSourceAvoided=true` |
| Next milestone | Phase 2.2 source reuse |

## End-to-End Flow

```text
User query
   |
   v
API Router
   |
   |-- Tier 1: search_kb / direct_model / deterministic fast paths
   |
   |-- Tier 2: web_research / ResearchOrchestrator / github_repo
   |
   |-- Tier 3: sandbox / computation fallback
   |
   v
Evidence + memory-aware execution
   |
   v
Faithfulness critic
   |
   v
Answer + citations + debug signals
```

## Services

```text
apps/web
  Next.js UI, chat surface, answer rendering, debug panels

apps/api
  Fastify API, router, tool endpoints, faithfulness critic, memory-aware answer path

apps/worker
  Background job execution through BullMQ/Redis

apps/rlm-runtime
  Sandbox/code execution fallback and tool-driven runtime

apps/model-service
  FastAPI service for model calls, scraping helpers, and Scrapling integration

packages/knowledge
  ResearchOrchestrator, evidence extraction, citation verification, memory, source ranking

packages/retrieval
  Qdrant/vector retrieval over project knowledge

packages/database
  Prisma/Postgres models for projects, documents, chunks, memories, reports
```

## Router Design

The router is deterministic and lives in `apps/api/src/modules/router/`.

| Tier   | Tool                     | Purpose                                                       |
| ------ | ------------------------ | ------------------------------------------------------------- |
| Tier 1 | `search_kb`              | Project/document/knowledge-base lookup                        |
| Tier 1 | `direct_model`           | Coding and simple algorithm answers                           |
| Tier 1 | deterministic fast paths | No-evidence traps, reverse linked list, simple known patterns |
| Tier 2 | `github_repo`            | GitHub repository analysis                                    |
| Tier 2 | `web_research`           | Fresh news, API docs, comparisons, current topics             |
| Tier 3 | `sandbox`                | Explicit computation and data transformation                  |

Router principle:

```text
Use the simplest reliable path first.
Only use research or sandbox when the query needs it.
```

## ResearchOrchestrator

The ResearchOrchestrator lives in `packages/knowledge/src/research/research-orchestrator.ts`.

Pipeline:

```text
plan
→ retrieve_memories
→ plan_resources
→ news/source-specific query planning
→ official-source seeding
→ source relevance gate
→ crawl
→ evidence extraction
→ evidence reranking
→ evidence pack
→ answer synthesis
→ optional synthesis retry
→ memory writes
```

Important modules:

| Module                  | Purpose                                                  |
| ----------------------- | -------------------------------------------------------- |
| `SearchPlannerAgent`    | Generates query plan and subqueries                      |
| `resource-planner.ts`   | Creates candidate source plans                           |
| `source-ranker.ts`      | Ranks official/trusted/media/community sources           |
| `source-relevance.ts`   | Rejects irrelevant sources before crawl                  |
| `crawl-manager.ts`      | Bounded Scrapling crawl with retry/dedupe/quality checks |
| `evidence-extractor.ts` | Extracts claim-level evidence                            |
| `evidence-pack.ts`      | Builds coverage, citation verification, and gaps         |
| `answer-synthesizer.ts` | Produces grounded answer                                 |
| `query-anchors.ts`      | Required synthesis groups for API/comparison queries     |

## Faithfulness Critic

The router faithfulness critic checks whether the answer is relevant and grounded.

Modes:

```text
evidence_pack
tool_preview
heuristic
```

The critic can:

```text
accept
retry
reject / partial
```

For `web_research`, the router may run a focused retry when the critic detects missing anchors or weak relevance.

## Harness

The harness lives in `harness/eval/`.

Main commands:

```bash
npm run eval
npm run eval:ci
npm run eval:phase2
npm run eval:analyze -- harness-runs/<run>
```

Phase 1 gates:

```text
routing accuracy = 100%
pass rate >= 0.9
mean reward >= 5.0
mean correctness >= 0.7
```

Reward includes:

```text
+ routing correctness
+ correctness
+ completeness
+ required content coverage
+ grounding
- wrong route
- missing required content
- low grounding
- forbidden claims
- latency failures
```

Harness outputs:

```text
harness-runs/<timestamp>/eval.json
harness-runs/<timestamp>/summary.md
harness-runs/<timestamp>/summary.csv
harness-runs/<timestamp>/*.trajectory.json
harness-runs/<timestamp>/analysis.md
```

## Phase 2.1 Scoped Memory Recall

Phase 2.1 wires memory into the router path.

Memory flow:

```text
setupMessages / user messages
   |
   v
explicit memory extraction
   |
   v
MemoryManager.addMany()
   |
   v
query-time MemoryManager.search()
   |
   v
memoryContext injection
   |
   v
answer path + debug.memory signals
```

Current supported memory behaviors:

| Behavior                                | Status   |
| --------------------------------------- | -------- |
| User preference extraction              | Complete |
| Blocked/untrusted source extraction     | Complete |
| Scoped recall by `projectId` + `userId` | Complete |
| Global memory isolation                 | Complete |
| Memory debug signals                    | Complete |
| Source reuse from prior research        | Next     |
| Graph context                           | Later    |

Memory kinds:

```text
preference
fact
durable_fact
source_quality
source_failure
decision
task_trace
```

Memory scopes:

```text
user
project
session
agent
source
```

## Memory Isolation Rules

Scout must avoid memory pollution.

Rules:

```text
If userId is provided:
  return user-specific memories + global memories

If userId is not provided:
  return only global memories

Eval harness:
  each run/case uses isolated user IDs

Harness cleanup:
  scripts/clear-harness-memory.mjs removes stale harness/eval memory rows
```

Memory is not automatically trusted as evidence. It is used as:

```text
preferences → style/constraints
source_quality → source boost/reuse
source_failure → source avoidance/downranking
durable_fact → context only when relevant
```

## Debug Signals

Phase 2 debug signals are exposed under `debug.memory` and harness trajectories:

```text
recallUsed
recalledCount
recalledKinds
blockedSourceAvoided
sourceReuseUsed
setupWritten
```

Future signals:

```text
recoveryAttempted
graphContextUsed
```

## Phase 2 Roadmap

| Phase | Goal                                        | Status   |
| ----- | ------------------------------------------- | -------- |
| 2.0   | Memory/context eval cases                   | Complete |
| 2.1   | Scoped memory recall                        | Complete |
| 2.2   | Source reuse from prior successful research | Next     |
| 2.3   | Bounded evidence recovery/self-healing      | Later    |
| 2.4   | Lightweight project/entity graph            | Later    |
| 2.5   | MCP/connectors with safety gates            | Later    |

## Design Principles

```text
1. Harness before feature.
2. Deterministic route before model call.
3. Evidence before answer.
4. Memory helps ranking/context; it does not replace evidence.
5. Failed answerable cases should not receive positive reward.
6. Avoid graph/MCP/recursion until eval shows the need.
```
