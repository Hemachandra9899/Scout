# Scout Test & Verification Plan (for the execution agent)

> Audience: a small agent whose ONLY job is to run the checks below, record results, and
> report back. **Do not fix failing code. Do not loosen thresholds/gates to make things pass.**
> If something fails, capture the exact output and stop at that step — a human/planning
> agent decides what to do next.

Run every step in order. Each step has: **command**, **expected result**, and **what to do
if it fails**. Work from the repo root (`/Users/teja/Desktop/Scout`) unless told otherwise.

---

## 0. Prerequisites

1. `.env` exists at repo root (copy from `.env.example` if missing — do not invent secret
   values; leave API keys blank if unknown).
2. Docker Desktop is running:
   ```bash
   docker info >/dev/null 2>&1 && echo "docker OK" || echo "DOCKER NOT RUNNING — stop here"
   ```
   If Docker is not running, **stop and report** — steps 3–5 below need the live stack.
   Steps 1–2 (typecheck, unit tests) do **not** need Docker and can run regardless.

---

## 1. Static verification (typecheck) — no stack required

Run each and confirm **zero errors** (only the `tsc --noEmit` banner, no `error TS...` lines):

```bash
npm run typecheck:api
npm run typecheck:knowledge
npm run typecheck:web
```

**Pass criteria:** all three exit 0 with no `error TS` output.
**On failure:** paste the full `error TS...` lines verbatim in the report. Do not attempt a fix.

---

## 2. Unit test suites — no stack required

```bash
npm run test:api
npm run test:knowledge
```

**Expected for `test:api`:** all test files pass (currently 47 tests across 3 files, including
`src/modules/chat/__tests__/intent-resolver.test.ts` and
`src/modules/router/__tests__/router-routing.test.ts`).

**Expected for `test:knowledge`:** the majority pass. **5 known pre-existing failures are
expected and should NOT be treated as new regressions**, in exactly these files:
- `src/research/__tests__/crawl-manager-retry.test.ts` (4 failures — retry-mode call-count mismatches)
- `src/research/__tests__/research-orchestrator.test.ts` (1 failure — a mocked resource scores
  below the relevance-gate `minScore` because its fixture title/url text doesn't literally
  contain the query's terms)

These are unrelated to routing/intent/memory/reranker/streaming work — root-caused and confirmed
pre-existing (their files' git history predates all of that work).

**Pass criteria:** `test:api` is 100% green. `test:knowledge` has **exactly** the 5 known
failures above (same test names) — not more, not fewer, not different ones.
**On failure (new/different failures):** paste the full failing test name + assertion output.
This would indicate a real regression — do not attempt a fix, report it.

---

## 3. Start the stack (only if Docker is running)

```bash
docker compose up -d --build
```

Wait until healthy, then confirm:

```bash
curl -sf http://localhost:8000/health && echo
curl -sf http://localhost:8000/health/deps && echo
```

**Pass criteria:** `/health` returns `{"status":"ok",...}`; `/health/deps` shows `ok` (or an
explicit non-fatal status) for each dependency (`database`, `qdrant`, `redis`, `rlmRuntime`,
`modelService`).
**On failure:** run `docker compose logs --tail=100 <service>` for whichever dependency is
unhealthy and paste the output. Do not modify service configs.

---

## 4. Harness eval gates — the real project gates (needs the stack)

Run in this order. **Do not modify any of these commands' env vars to force a pass.**

```bash
npm run eval:ci
npm run eval:phase2
npm run eval:phase3
npm run eval:routing-intent
```

**Pass criteria (from `docs/architecture/ARCHITECTURE.md` / project standard):**
| Suite | Target |
|---|---|
| `eval:ci` (Phase 1) | pass rate ≥ 0.9, mean reward ≥ 5.0, **routing accuracy = 100%** |
| `eval:phase2` | 7/7 pass |
| `eval:phase3` | current case count, 100% pass |
| `eval:routing-intent` | all cases in `harness/eval/routing-intent-cases/` pass (adversarial routing, focused-retry, provider-fallback) |

Each run writes to `harness-runs/<timestamp>/`. After each command, capture:
```bash
LATEST=$(ls -td harness-runs/* | head -1)
cat "$LATEST/summary.md"
```

**Pass criteria overall:** all four suites meet their targets above with **no routing
regressions** (every case's actual tool/tier matches expected).
**On failure:** paste `summary.md` and the specific failing case IDs + their `reason`/`failures`
column. Do not tune scoring/thresholds to force a pass.

---

## 5. Manual smoke checks (needs the stack + a browser)

These cover the streaming chat + intent + Apps panels, which aren't covered by the harness.

1. Open the web app (`http://localhost:3000` or the configured web port).
2. Create/select a project.
3. Send `hi` → expect: a brief animated "Thinking…" indicator, then a streamed, markdown-formatted
   greeting/capabilities answer. **No raw research "steps" shown** (unless Dev mode is on).
4. Send `what is the latest WhatsApp news?` → expect: "Researching…" indicator, then a streamed
   answer with citations.
5. Click the `+` button → select **GitHub repository** → paste a GitHub URL → expect the mode
   chip shows "GitHub repo" and the reply analyzes that repo regardless of phrasing.
6. Toggle **Dev mode** (top-right terminal icon) → resend a message → expect the step
   trace / sources / debug panel to appear (they should be hidden when Dev mode is off).
7. Open the **Apps** menu → check each panel opens without a blank screen:
   - **Memory Graph** — lists memories (empty state OK if none exist yet).
   - **Documents** — lists uploaded documents (empty state OK).
   - **Graph Reports** / **Repo Graph** — shows the latest GRAPH_REPORT.md or a clear
     "no report yet" message (not a blank screen).
   - **Agent Runs** — opens without error.

**Pass criteria:** every step above matches its expected behavior; nothing renders blank,
raw/unformatted, or throws a visible error.
**On failure:** note the exact step number, what you saw instead, and open the browser
console (`F12` → Console/Network tabs) — paste any red errors or failed requests (status ≠ 2xx).

---

## 6. Report format

Return results as this table (fill in ✅ / ❌ / ⛔ skipped, plus notes for anything not ✅):

```
| Step | Check                          | Result | Notes |
|------|---------------------------------|--------|-------|
| 1    | typecheck:api                    |        |       |
| 1    | typecheck:knowledge               |        |       |
| 1    | typecheck:web                     |        |       |
| 2    | test:api (47 tests)               |        |       |
| 2    | test:knowledge (5 known failures) |        |       |
| 3    | stack health                      |        |       |
| 4    | eval:ci                          |        |       |
| 4    | eval:phase2                       |        |       |
| 4    | eval:phase3                       |        |       |
| 4    | eval:routing-intent               |        |       |
| 5    | manual smoke (1–7)                |        |       |
```

## Hard rules for the execution agent
- Never edit test files, eval case files, threshold envs, or gate scripts to make a check pass.
- Never run destructive commands (`docker compose down -v`, `prisma migrate reset`, etc.).
- If a step fails, stop that step, record it, and continue to the next independent step
  (don't cascade-skip everything — e.g., a `test:knowledge` failure doesn't block `eval:ci`).
- Report exact command output, not paraphrases.
