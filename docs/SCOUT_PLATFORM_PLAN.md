# Scout Platform Plan — Execution Roadmap

> From "evidence-first research engine" → "self-improving, problem-solving agent platform."
> Status: planning document. No production code is implied by this file. Every milestone ships
> behind an eval gate. Deterministic-first, model-second. Firecrawl is optional and off by default.

---

## 0. North star & principles

Scout today plans → searches → crawls → extracts evidence → verifies → answers, with scoped
add-only memory and a deterministic repo graph. The upgrade keeps that discipline but adds:

- **Better input** (hybrid retrieval + reranking, Cursor-style).
- **Better memory** (tiered, self-curating, single-writer).
- **Better orchestration** (typed parallel agents → controlled swarm).
- **Better economics** (multi-layer caching, streaming, budgets).
- **Self-improvement** (procedural memory fed by evals/outcomes).
- **Proper sandbox use** (compute, git/repo analysis, verification) with hard isolation + budgets.

### Non-negotiable principles
1. **Harness before feature.** A capability is not "done" until an eval moves and no gate regresses.
2. **Deterministic before model.** Cheap deterministic logic first; LLM only for genuine ambiguity.
3. **Evidence before answer.** Memory helps ranking/context; it is not evidence unless cited.
4. **One writer for memory.** Only the curator writes; everyone else proposes.
5. **Everything is budgeted.** Wall-clock, tokens, tool-calls, depth, concurrency — enforced centrally.
6. **Flag-gated rollout.** New executor/retrieval/cache paths ship behind env flags, default off,
   flipped on only when their eval gate passes.

### Standing eval gates (must stay green at every milestone)
- Phase 1: 10/10 · Phase 2: 7/7 · Phase 3: 100% · routing accuracy 100% · no typecheck failures.
- Commands: `npm run eval:ci`, `npm run eval:phase2`, `npm run eval:phase3`,
  `npm run typecheck:api && npm run typecheck:knowledge && npm run typecheck:web`.

---

## 1. Current-state audit (what we are building on)

| Area | Today | Implication |
|---|---|---|
| Routing | Keyword cascade in `apps/api/src/modules/router/router.service.ts:379` (`routeScoutQuery`) | Order-dependent collisions; brittle. |
| Intent | 3 disagreeing systems: `routeScoutQuery`, `rlm-runtime/intentDetector.ts`, `rlm-runtime/fastIntentDetector.ts` | LLM detectors are dead weight; API router never calls them. |
| Research | `packages/knowledge/src/research/research-orchestrator.ts` — **sequential** subquery/news/focused/recovery loops (lines 219, 244, 302, 611) | Main latency source. |
| Critic retry | `router.service.ts:1048` runs a **second full** `webResearch` serially | Up to 2× the 120s timeout. |
| Memory | Flat add-only table; `memory-manager.ts` keyword `scoreMemory`; batch-only dedup | No relevance gate, cross-run dupes, global leakage. |
| Reranking | `evidence-reranker.ts` is lexical only | Weak context selection. |
| Providers | `Promise.allSettled` base (`search-provider.ts:95`); Firecrawl `enabled:true` default | Resilient base, but no quota/exhaustion handling, no local-fetch. |
| Sandbox | Pyodide WASM singleton (`apps/rlm-runtime/src/services/pythonSandbox.ts`); tool-bridge egress only | Good isolation, **no budgets/timeouts/state-reset**. |
| Git details | GitHub REST API (`tools.service.ts:295` `githubRepo`) | API-based, no clone; fine for metadata, not for history/blame/diff. |
| Graph dedupe | `Entity`/`Relation` have non-unique `@@index` only (`prisma/schema.prisma:120,135`) | Duplicate-row risk depends entirely on builder logic. |
| Answer synth | `answer-synthesizer.ts` deterministic | Fast, testable — keep. |

### Concrete bugs found
- `router.service.ts:299` — `isRepoGraphReportQuery` tests `q.includes("generate.*graph.*report")` (a literal substring of a regex). **Never matches.**
- `router.service.ts:455–483` — bare `"api"` and `"compare"` substrings force `web_research`, mis-routing
  `"compare these two arrays in python"` (code) and `"what does this api key in my uploaded file do"` (KB).
- `memory-manager.ts` `addMany` dedupes within a batch only → durable facts re-written every run.
- `search-provider-config.ts` — Firecrawl enabled in every route; no exhaustion handling.

---

## 2. Target architecture (the 6 pillars)

```
Streaming Chat UI
      │
Intent Planner  (deterministic overrides + LLM, emits typed task DAG)
      │
Agent Executor  (Controller: budgets · permissions) → parallel agents
      │
Hybrid Retrieval → Reranker   (BM25 + vector + cross-encoder)
      │
Tiered Memory + Curator (sole writer)
      │
Stores (Postgres · Qdrant · Redis/BullMQ)

Cross-cutting:  Caching (prompt/retrieval/embedding/answer)
Feedback loop:  Harness · Evals → learned strategies → procedural memory
Compute:        Sandbox (Pyodide compute + optional isolated git/exec)
```

---

## 3. Milestone plan

Each milestone is independently shippable, eval-gated, and small enough to review. Ordering reflects
dependencies and leverage. Estimated effort is relative (S/M/L), not calendar time.

### M0 — Measurement foundation *(do first; "target to beat")*  · effort: M
**Goal:** make "is it good?" a number, not a vibe. Nothing improves until we can measure it.
- Add `harness/eval/routing-cases/` — 30–50 **adversarial routing cases** with `expectedTool`/`expectedTier`,
  including the trap queries above (code-compare, KB-api, typo'd entities, graph-report phrasing).
- Add `harness/eval/retrieval-cases/` — labeled query→relevant-source sets for **recall@k / nDCG**.
- Instrument the harness to record **latency, cost (tokens), and per-stage timing** per case
  (extend the existing `researchTrace` plumbing) into `summary.csv`.
- Run the **current** router/retrieval against these sets → record baselines in
  `docs/baselines/` (this is the number every later milestone must beat).
- **Eval gate:** new sets run green in CI (reporting mode, not blocking yet).
- **Done when:** baseline routing accuracy + retrieval nDCG + p50/p95 latency + cost/query are recorded.
- **Risk:** label quality. Mitigation: keep sets small, hand-verified, version-controlled.

### M1 — Provider reliability guard *(unblocks running without Firecrawl)* · effort: M
**Goal:** Firecrawl-independent research. Posture: **Tavily → GitHub → local-fetch, Firecrawl off.**
- `search-provider-config.ts`: default `FIRECRAWL_ENABLED=false`; honor `TAVILY_ENABLED`,
  `GITHUB_SEARCH_ENABLED`, `LOCAL_CRAWL_ENABLED`, (`BRAVE_SEARCH_ENABLED` reserved).
- Add a **local-fetch provider** (`search-providers/local-fetch.provider.ts`): direct HTTP GET of
  known/seeded URLs (official-source catalog) when no paid provider is available. No JS render; cheap.
- Prefer GitHub API for github/repo/code queries (already routed in `search-routing.ts`).
- **Exhaustion detection:** classify provider errors; on quota/credit/rate-limit (`402/429`, "credit",
  "quota", "rate limit"), mark the provider `exhausted` **for that run** and continue with the rest
  (build on the existing `Promise.allSettled` in `search-provider.ts:95`).
- **New debug signals** (surface in `searchTrace` + router `debug`): `providerFallbackUsed`,
  `exhaustedProviders`, `selectedProviders`, `skippedProviders`, `providerErrors`.
- **Eval gate:** new case "Firecrawl disabled, Tavily/GitHub answer succeeds"; existing research evals
  green with `FIRECRAWL_ENABLED=false`.
- **Done when:** a full research run completes with Firecrawl off and exposes the 5 signals.
- **Risk:** local-fetch hitting bot walls. Mitigation: only for seeded official URLs; record as failure memory.

### M2 — Parallelization + lazy memory + streaming groundwork · effort: M
**Goal:** kill the "slow answer" complaint.
- `research-orchestrator.ts`: convert the **sequential fan-out loops** (subquery `:219`, news `:244`,
  focused `:302`, recovery `:611`) to `Promise.all` with a **bounded concurrency** helper (cap 4).
- `router.service.ts:883`: make memory recall **lazy** (only for routes that use it) and run it
  **concurrently** with the route's first stage.
- `router.service.ts:1048`: replace the serial double-research with a **smaller-budget focused pass**
  (fewer sources/pages), triggered only on genuine anchor-miss.
- Add a **streaming contract** scaffold: emit `partial` answer + `researchTrace` stages as they complete
  (SSE/job-progress) so the UI shows progress. (UI wiring can follow.)
- **Eval gate:** latency assertion — parallel run p50 ≤ X% of M0 baseline on the same cases; all
  answer-quality gates unchanged.
- **Done when:** planning phase collapses from `S×rtt` serial to ~1–2 concurrent waves.
- **Risk:** provider rate limits under concurrency. Mitigation: concurrency cap + per-domain cap (already present).

### M3 — Unified Intent Classifier · effort: M
**Goal:** one source of truth for routing; fix collisions; "add good prompting."
- New `packages/knowledge/src/router/intent-classifier.ts` returning a typed
  `RouteIntent { tool, tier, confidence, normalizedQuery, signals[], analysisAngles[], reason }`.
- **Two-stage:** (1) deterministic hard overrides (github URL, "graphify/memo this repo", uploaded-doc,
  insufficient-evidence) short-circuit; (2) one **well-prompted LLM classifier** for the ambiguous middle,
  with a deterministic fallback to the existing keyword logic on model failure/bad JSON.
- Remove the Meta/"mets graph api" hardcodes (`intentDetector.ts:44,92`); replace with general
  entity-normalization. Delete/merge the redundant `fastIntentDetector.ts` path.
- Fix the 3 collisions (code-vs-research compare, bare "api", the broken `generate.*graph.*report` regex).
- Expose `routingConfidence`, `routeSignals`, `routeReason` in `debug`.
- **Eval gate:** M0 adversarial routing set accuracy ↑ vs baseline; routing 100% on existing cases;
  added latency from the LLM stage stays under budget (overrides must catch the easy majority).
- **Done when:** the trap queries route correctly and the number is recorded.
- **Risk:** LLM latency/cost on hot path. Mitigation: measure override hit-rate; cache classifier output (M6).

### M4 — Tiered memory + sole-writer curator · effort: L
**Goal:** "manage memory well" + the substrate for self-learning.
- Introduce memory **tiers** via a `tier` field/metadata: `working | episodic | semantic | procedural`.
- **Curator** (`packages/knowledge/src/memory/memory-curator.ts`) becomes the **only writer**:
  - **Dedup against the DB** before insert (content-hash column or `@@unique` + upsert) — fixes cross-run dupes.
  - **Relevance gate** on injected memory (drop below a min rerank score; cap context tokens) — stops
    irrelevant memories polluting prompts (`buildMemoryContext` in `router.service.ts:136`).
  - **Decay/TTL**: recency decay for global + volatile kinds; provenance required for `durable_fact`.
  - **Fact-vs-context split:** durable facts surface as "previously verified [source]", never silently
    asserted as new claims.
- **Isolation hardening:** scope-aware recall; document global-vs-user rules; keep harness cleanup.
- **Debug:** per-memory `score`, `reason`, `confidence`, `tier` (answers "why was this memory used").
- **Eval gate:** memory-precision metric ↑; "zero dupes after 2 identical runs" assertion; Phase 2 = 7/7.
- **Done when:** curator is the sole writer and dupes are structurally impossible.
- **Risk:** over-aggressive dedupe dropping legitimate updates. Mitigation: dedupe on (scope,kind,normalized-text,urls), not text alone.

### M5 — Hybrid retrieval + reranker *(biggest quality lever)* · effort: L
**Goal:** Cursor-style retrieve-then-rerank across evidence, code, and memory.
- **Hybrid recall:** combine lexical (BM25/keyword) with dense (Qdrant) candidates, then **rerank** with a
  cross-encoder/LLM reranker; keep top-k only. Replace lexical-only `evidence-reranker.ts` internals.
- Apply the **same reranker** to 3 surfaces: research evidence, repo-graph/code chunks, and memory recall.
- Keep a **deterministic fallback** (current lexical reranker) when the reranker provider is unavailable.
- **Eval gate:** retrieval nDCG/recall@k ↑ vs M0 baseline; grounding unchanged or better; latency within budget
  (reranker results cached in M6).
- **Done when:** answers cite better sources and the nDCG number is up.
- **Risk:** added embedding/model dependency + latency. Mitigation: cache (M6) + fallback + top-k bound.

### M6 — Caching (4 layers) · effort: M
**Goal:** efficiency + cost; make M3/M5 affordable.
- **Prompt/LLM cache:** Anthropic prompt caching for stable system prompts + repeated evidence;
  **semantic query cache** (embed query → reuse answer for near-duplicates).
- **Retrieval cache:** `query → ranked+reranked sources`, TTL keyed by freshness (news short, docs long).
- **Embedding cache:** never re-embed unchanged chunks — extend the existing content-hash approach
  (already used for the repo graph) to research crawl + KB.
- **Answer cache:** `query + evidence-fingerprint → answer`, **invalidated** on memory/graph updates.
- Storage: Redis (already present) for hot caches; Postgres for durable.
- **Debug:** `cacheHit`, `cacheLayer`, `cacheKey` per stage; harness reports cache hit-rate + cost/query.
- **Eval gate:** cost/query and p95 latency ↓ vs M5 with answer-quality unchanged.
- **Risk:** stale answers. Mitigation: freshness-aware TTL + explicit invalidation hooks.

### M7 — Agent executor (typed agents → controlled swarm) · effort: L
**Goal:** "handle agents well" + parallel multi-angle analysis. Evolves `packages/knowledge/src/agents/`.
- **Typed contracts** (extend `agents/types.ts`): `AgentSpec { allowedTools, budget, canWriteMemory:false }`,
  `AgentTask { dependsOn[] }`, `AgentTrace`. Roles: planner, researcher, crawler, evidence, verifier,
  answer, critic, **memory-curator (sole writer)**, graph_builder, graph_query, reporter.
- **Orchestrator** = blackboard (typed shared run state) + DAG scheduler (topological, bounded concurrency)
  + **controller** (enforces global budget/iterations, clamps per-task budgets, blocks disallowed tools
  *before* they run, kills over-budget tasks → records `budgetExceeded`).
- **Tool permission matrix** + memory write rules (only curator writes; others emit `proposedMemories`).
- **Parallel multi-angle analysis:** planner emits disjoint `analysisAngles`; scheduler runs a
  research→crawl→evidence chain per angle concurrently; one answer + one critic merge them.
- Ship behind `SCOUT_EXECUTOR=linear|agents|swarm`, **default `linear`**.
- **Debug:** `debug.executor = { mode, taskGraph, traces, parallelWaves, budgetExceeded, permissionDenied,
  proposedMemoryCount, writtenMemoryCount }`.
- **Eval gates:** (agents) output parity with linear on all existing cases; (swarm) multi-angle coverage,
  controller aborts on injected runaway budget, permission matrix blocks a disallowed tool, no dupes after 2 runs.
- **Done when:** swarm mode passes its gate; only then is the default flipped.
- **Risk:** complexity/regressions. Mitigation: wrap existing pure functions (no new research logic);
  flag-gated; parity eval before default.

### M8 — Sandbox: proper usage, git details, isolation, budgets · effort: M–L
See the dedicated **Section 4** below for the full design. Milestone scope:
- Add **budgets** to the Pyodide sandbox (wall-clock timeout, max output size, max tool-calls, max steps).
- **Reset interpreter state** between runs (fresh namespace) to prevent cross-run leakage.
- Add a **`git_repo` compute helper** that fetches structured repo data via the GitHub API and lets sandbox
  code compute over it (commit-frequency, file metrics, import graphs) deterministically.
- Define (design only, gated) an **isolated exec sandbox** for true git operations (shallow clone, diff,
  blame) — containerized, read-only, no secrets, ephemeral, strict network allowlist.
- Treat the sandbox as a **tool with a permission + budget** inside the M7 executor.
- **Eval gate:** sandbox computation cases (e.g., "last 100 commits frequency", "sort/dedupe/mean") pass;
  a timeout case proves the budget aborts cleanly.
- **Risk:** exec sandbox is the highest-risk surface — keep it behind a flag and a hard permission gate.

### M9 — Self-learning loop + harness scorecard · effort: M
**Goal:** Scout measurably improves each run, safely.
- After each run, the **critic/harness scores the outcome**; the **curator writes procedural memory**
  ("for API-comparison queries, sources X/Y worked; route Z was correct").
- The **planner + reranker read procedural memory** next time (closes the loop). This is reinforcement from
  *evals/outcomes*, not online weight training — inspectable and reversible.
- Expand the harness from pass/fail to a **scorecard**: routing accuracy, retrieval nDCG, grounding,
  latency, cost/query, memory precision, cache hit-rate — with per-layer regression gates + trace replay.
- **Eval gate:** procedural-memory improves routing/source-selection on a held-out set without regressing
  any standing gate; self-learning writes are dedup'd and provenance-tagged.
- **Risk:** feedback loops reinforcing bad strategies. Mitigation: procedural memory is evidence-tagged,
  decays, and is overridable; the harness held-out set guards against overfit.

---

## 4. Sandbox: how Scout uses it properly

> The sandbox is for **computation and verification**, not for being a second router. It runs deterministic
> work that an LLM should not guess: data transforms, repo/code metrics, "git details," and answer
> verification. Today it is **Pyodide (in-process WASM Python)** in `apps/rlm-runtime`, with a JS tool-bridge
> as its only egress. That is a strong isolation base; what it lacks is **budgets, state reset, and a clear
> usage contract.** This section fixes that.

### 4.1 What runs in the sandbox (and what does not)
| Use it for | Do NOT use it for |
|---|---|
| Deterministic compute: sort/dedupe/aggregate, stats, parsing | Free-form web browsing (use crawler/providers) |
| Repo/code metrics over fetched data: commit frequency, file/size histograms, import graphs | Storing secrets or long-lived state |
| Answer verification: re-run a calculation the model produced | Arbitrary host shell / filesystem access |
| Transform tool outputs into typed JSON for synthesis | Anything that should be a deterministic router rule |

### 4.2 Two sandbox tiers

**Tier A — Pyodide compute sandbox (current, harden it).**
- In-process WASM Python. **No host filesystem, no direct network** — the only egress is the JS bridge
  (`_rlm_tool_js` / `_rlm_query_js` in `pythonSandbox.ts`), which exposes a fixed allowlist:
  `search_kb`, `web_research`, `crawl_url`, `github_repo`, `query_graph`, `llm_query`, `final`.
- This is already well-isolated. Hardening to add:
  - **Wall-clock timeout** around `pyodide.runPythonAsync` (abort + return partial stdout).
  - **Output cap** (truncate stdout / final value) and **max tool-calls / max steps** per run.
  - **State reset:** create a fresh namespace per run (or reload module-level state) so imports/globals
    don't leak between unrelated runs (the interpreter is a singleton today).
  - **Determinism:** seed RNG, freeze clock where feasible, so eval cases are reproducible.

**Tier B — Isolated exec sandbox (design only, flag-gated, future).**
- For true git operations the API can't do (full history, `git blame`, real `git diff`, building/running code):
  a **containerized worker** (separate from Pyodide) that:
  - does a **shallow** `git clone --depth=N --filter=blob:none` of a public repo into an **ephemeral** workdir,
  - runs analysis with **dropped capabilities, read-only rootfs, no host mounts, no secrets/env, and a
    network allowlist** (GitHub only, or fully offline after clone),
  - returns **typed JSON** (never raw shell), and is **torn down** after the run.
  - Enforced budgets: max clone size, max wall-clock, max CPU/mem, max output. Gated by
    `EXEC_SANDBOX_ENABLED=false` by default and a per-agent permission.

### 4.3 "Getting details from git" — the strategy
- **Metadata/tree/files → GitHub REST API** (current `githubRepo`, `tools.service.ts:295`). Cheap, reliable,
  no clone. Uses `GITHUB_TOKEN`; ranks paths (`rankRepoPath`), fetches raw file text, builds a deterministic
  summary. **This stays the default for repo Q&A and graphify.**
- **Computation over git data → Tier A sandbox.** Add a `git_repo(owner, repo)` helper that returns
  structured data (tree, selected files, last-N commits, languages) so sandbox code can compute:
  commit-frequency over time, churn/hot-files, dependency/import graphs, file-size distributions — things
  the model should not estimate.
- **History/blame/diff/build → Tier B exec sandbox** (only when the API is insufficient and the query
  genuinely needs it; flag + permission gated).
- **Decision rule:** API for *facts about the repo*, Tier A for *computation over those facts*, Tier B for
  *operations that require a real working tree*. Never clone when the API answer suffices.

### 4.4 Sandbox as an executor tool (M7 integration)
- The sandbox is an agent tool with an `AgentSpec`: `allowedTools` limited to the bridge allowlist,
  `budget` (time/output/steps), `canWriteMemory:false` (it proposes, the curator writes).
- The controller enforces the sandbox budget and records a trace (`stdout` size, `toolCalls`, duration,
  `budgetExceeded`). Sandbox failures degrade to a partial answer; they never crash the run.

### 4.5 Sandbox debug signals
`debug.sandbox = { used, tier, durationMs, toolCalls[], stdoutBytes, finalCalled, timedOut, budgetExceeded, error }`.

---

## 5. Eval gate summary

| Milestone | New/required gate (in addition to standing gates) |
|---|---|
| M0 | Adversarial routing + retrieval sets run; baselines recorded |
| M1 | "Firecrawl disabled" research succeeds; 5 provider signals present |
| M2 | Parallel p50 ≤ X% of baseline; quality unchanged |
| M3 | Routing accuracy ↑ on adversarial set; routing 100% on existing |
| M4 | Memory precision ↑; zero-dupe-after-2-runs; Phase 2 = 7/7 |
| M5 | Retrieval nDCG/recall@k ↑; grounding ≥ baseline |
| M6 | Cost/query + p95 latency ↓; quality unchanged |
| M7 | Agents parity with linear; swarm safety cases (budget/permission/dupe) pass |
| M8 | Sandbox compute cases pass; timeout aborts cleanly |
| M9 | Procedural memory improves held-out routing/source selection; no regressions |

---

## 6. Risks & guardrails

- **Measure before claiming.** M0 exists so every later "better" is a number that moved, not a vibe.
- **Don't build the swarm early.** M7 swarm mode stays default-off until pillars M2–M5 are solid and an
  eval *demonstrates* it answers better. Complexity you can't prove you need is a liability.
- **New model/embedding dependencies (M3/M5/M6)** must each have a deterministic fallback so a provider
  outage degrades gracefully instead of breaking the run.
- **Sandbox Tier B is the highest-risk surface.** It stays flag-gated, containerized, ephemeral, secret-free,
  and behind a per-agent permission. Default off.
- **Feedback loops (M9)** can reinforce bad strategies; procedural memory must decay, carry provenance, and
  be overridable, with a held-out eval set as the guard.
- **Contract stability.** Do not break the existing API/UI `research-response` contract; extend `debug`/`ui`
  additively.

---

## 7. Recommended execution order

1. **M0** (measurement) → 2. **M1** (provider guard) → 3. **M2** (parallel + streaming) →
4. **M3** (intent) → 5. **M4** (memory) → 6. **M5** (retrieval/rerank) → 7. **M6** (caching) →
8. **M8** (sandbox hardening — can be pulled earlier if sandbox-heavy queries matter) →
9. **M7** (agent executor/swarm) → 10. **M9** (self-learning + scorecard).

M0→M2 are the fastest path to a Scout that is **faster, Firecrawl-independent, and measurable**. M3→M6 make
it **smarter and cheaper**. M7→M9 make it **agentic and self-improving** — only after the foundation is proven.

---

## Appendix A — New env flags
```
FIRECRAWL_ENABLED=false            # off by default (credits exhausted)
TAVILY_ENABLED=true
GITHUB_SEARCH_ENABLED=true
LOCAL_CRAWL_ENABLED=true
BRAVE_SEARCH_ENABLED=false         # reserved
SCOUT_EXECUTOR=linear              # linear | agents | swarm
RERANKER_ENABLED=false             # M5, flag-gated
ANSWER_CACHE_ENABLED=false         # M6
EXEC_SANDBOX_ENABLED=false         # M8 Tier B, default off
```

## Appendix B — New debug signals (additive)
```
debug.providers   = { providerFallbackUsed, exhaustedProviders, selectedProviders, skippedProviders, providerErrors }
debug.routing     = { tool, tier, confidence, signals[], reason }
debug.memory[i]   = { score, reason, confidence, tier }
debug.retrieval   = { recallCount, rerankedCount, rerankerUsed, nDcgSample }
debug.cache       = { cacheHit, cacheLayer, cacheKey }
debug.executor    = { mode, taskGraph, traces, parallelWaves, budgetExceeded, permissionDenied }
debug.sandbox     = { used, tier, durationMs, toolCalls, stdoutBytes, timedOut, budgetExceeded, error }
```

## Appendix C — Related docs
- `docs/ARCHITECTURE.md` — current architecture & phase status.
- `docs/GRAPHIFY_REFERENCE_NOTES.md` — repo graph reference.
- `docs/SCOUT_SWARM_READINESS_PLAN.md` — *(to be written)* full agent/swarm safety spec (expands M7).
- `docs/SCOUT_SYSTEM_AUDIT.md` — *(to be written)* detailed file-referenced audit (expands Section 1).
