# Scout Architecture

## Overview

Scout is a research engine that takes a user query and produces a grounded, cited answer.
It uses a tiered router to select the best strategy for each query type.

## Services

```
┌──────────┐     ┌──────────────┐     ┌─────────────┐
│   Web    │     │  API         │     │  Knowledge   │
│  (Next)  │────▶│  (Fastify)   │────▶│  Package     │
└──────────┘     └──────┬───────┘     └──────┬──────┘
                        │                    │
                        ▼                    ▼
                 ┌──────────────┐     ┌─────────────┐
                 │  Model       │     │  Qdrant      │
                 │  Service     │     │  (Vector DB) │
                 │  + Scrapling │     └─────────────┘
                 └──────────────┘
                        │
                        ▼
                 ┌──────────────┐     ┌─────────────┐
                 │  RLM Runtime │     │  Redis       │
                 │  (Deno)      │     │  + BullMQ    │
                 └──────────────┘     └─────────────┘
```

## Router (`apps/api/src/modules/router/`)

The `routeScoutQuery()` function classifies queries by keyword heuristics (no LLM call):

| Tier | Route/Tool | When |
|------|-----------|------|
| 1 | `direct_model` | Coding questions (algorithm, leetcode, complexity) |
| 1 | `search_kb` | Document/knowledge-base lookup, no-evidence traps |
| 2 | `github_repo` | GitHub repository URLs |
| 2 | `web_research` | News, API docs, comparisons, current topics |
| 3 | `sandbox` | Computation, data transformation, sorting |

The `answerWithRouter()` function dispatches to the appropriate handler:

- **`web_research`**: Invokes `ResearchOrchestrator` (full pipeline: plan → search → crawl → extract → synthesize)
- **`direct_model`**: Hardcoded fast paths (reverse-linked-list) or model-based coding answer
- **`github_repo`**: Fetches repo structure via GitHub API
- **`search_kb`**: Searches Qdrant knowledge base + model synthesis
- **`sandbox`**: Executes via RLM runtime sandbox

## Research Orchestrator (`packages/knowledge/src/research/`)

The full research pipeline:

1. **Plan** — `SearchPlannerAgent` generates subqueries
2. **Retrieve memories** — `MemoryAgent` retrieves past knowledge
3. **Plan resources** — For each subquery, plans URLs/sources
4. **News planning** — Builds news-specific queries
5. **Official source seeding** — Adds official docs URLs
6. **Merge and rank** — All resources merged, ranked by relevance
7. **Crawl** — `CrawlManager` with Scrapling (auto/dynamic/stealth modes)
8. **Extract evidence** — `EvidenceExtractor` extracts claim-level evidence
9. **Rerank evidence** — Scores and filters evidence
10. **Synthesize answer** — Deterministic answer rendering by mode (comparison, how-to, research summary, general)

## Faithfulness Critic (`apps/api/src/modules/router/faithfulness-critic.ts`)

Verifies that the answer is grounded in the evidence:

- **Evidence-anchored mode**: Checks answer claims against evidence pack citations
- **Relevance mode**: Checks answer mentions key query anchors
- **Heuristic fallback**: Simple relevance-ratio check when no evidence pack

On `retry` verdict, the router runs a focused second attempt.

## Eval Harness (`harness/eval/`)

Suite of 10 test cases covering all router tiers and edge cases. Reward computation factors:
- Routing correctness (+2)
- Answer correctness (+1)
- Answer completeness (+1)
- Required content coverage (+1)
- Grounding adequacy (+1)
- Latency penalty (-2 if over limit)
- No-evidence refusal floor (+2 minimum for safe refusals)
