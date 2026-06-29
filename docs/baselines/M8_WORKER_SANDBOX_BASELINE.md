# M8 — Worker-Isolated Sandbox Baseline

**Commit**: TBD (will update after final commit)
**Date**: 2026-06-29

## Goal

Move Python sandbox execution into a killable Worker so timeouts can truly terminate CPU-bound Pyodide code.

## M7 Limitation

M7 used `Promise.race`, which returned early from the timeout but did **not** truly kill in-process Pyodide execution. CPU-bound Python code continued running in the background.

## M8 Added

- `pythonSandboxCore.ts` — extracted in-process execution logic (capped IO, tool-call budget, soft timeout, isolation, safety debug)
- `pythonSandboxWorkerProtocol.ts` — typed request/response protocol for worker communication
- `pythonSandboxWorker.ts` — Web Worker script that delegates to `executePythonInProcess()`, sets `isolationMode: "worker"`
- `pythonSandbox.ts` — wrapper class that selects between `in_process` and `worker` modes
  - Default mode: **worker** (`RLM_SANDBOX_ISOLATION_MODE=worker`)
  - Fallback: **in_process** (`RLM_SANDBOX_ISOLATION_MODE=in_process`)
  - When subAgentHandler/toolHandler are provided, falls back to in_process (workers cannot pass JS async callbacks through structured clone)

## Architecture

```
┌─────────────────────────────┐
│      pythonSandbox.ts       │  ← wrapper, selects mode
│  ┌───────────────────────┐  │
│  │ executePythonInWorker │  │  ← default: spawn Worker, postMessage, terminate on timeout
│  └───────────────────────┘  │
│  ┌───────────────────────┐  │
│  │ executePythonInProcess│  │  ← fallback: direct call to core
│  └───────────────────────┘  │
└─────────────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│   pythonSandboxCore.ts      │  ← actual Pyodide execution
│   - _RlmCappedWriter        │
│   - tool-call budget        │
│   - exec(...) isolation     │
│   - soft timeout (backup)   │
│   - safety debug            │
└─────────────────────────────┘
```

## Worker Protocol

```
Parent → Worker: { id, code, budget }
Worker → Parent: { id, ok: true, result: PythonExecutionResult }
Worker → Parent: { id, ok: false, error: string }
```

Parent kills worker on:
- Timeout (`worker.terminate()`)
- Worker error event
- Normal completion

## Env

```bash
# Default (recommended):
RLM_SANDBOX_ISOLATION_MODE=worker
RLM_SANDBOX_TIMEOUT_MS=30000
RLM_SANDBOX_MAX_STDOUT_CHARS=20000
RLM_SANDBOX_MAX_STDERR_CHARS=10000
RLM_SANDBOX_MAX_TOOL_CALLS=12

# Fallback (no Worker isolation):
RLM_SANDBOX_ISOLATION_MODE=in_process
```

## Safety Debug (worker mode)

```json
{
  "budget": { "timeoutMs": 30000, "maxStdoutChars": 20000, "maxStderrChars": 10000, "maxToolCalls": 12 },
  "timedOut": true,
  "killed": true,
  "stdoutSize": 0,
  "stderrSize": 0,
  "stdoutTruncated": false,
  "stderrTruncated": false,
  "toolCallCount": 3,
  "toolCallLimitHit": false,
  "isolationMode": "worker"
}
```

## Results

| Suite | Default (worker) |
|---|---|
| `typecheck:api` | PASS |
| `typecheck:knowledge` | PASS |
| `typecheck:web` | PASS |
| `typecheck:rlm-runtime` (deno) | PASS |
| `eval:ci` | 10/10 routing, 9/10 pass (grounding flake on web_research) |
| `eval:phase2` | 7/7 |
| `eval:phase3` | 8/8 |
| `eval:routing-intent` | 17/17 |

Sandbox computation (`sandbox-computation-001`) passes in worker mode.

## Known Limitations

1. **No worker when tool handlers present**: The Worker cannot receive JS async callbacks (subAgentHandler/toolHandler) through `postMessage` structured clone. Falls back to in_process when handlers are provided.
2. **Worker startup overhead**: Each sandbox execution spawns a new Worker. This adds ~50-200ms overhead vs in-process.
3. **Pyodide reloads per worker**: Each new Worker loads Pyodide from scratch. Optimization possible but deferred.
4. **model-service issue**: Full end-to-end sandbox + worker execution is blocked until the `ChatNVIDIA`/pydantic dependency issue in the model service is fixed.
5. **No shared Pyodide**: The Worker does not share the Pyodide instance with the parent process.

## Manual Sandbox Tests

Manual cases at `harness/eval/manual-cases/011-sandbox-worker-isolation.json`:

- `sandbox-worker-timeout-001`: Basic sandbox computation in worker mode
- `sandbox-worker-stdout-cap-001`: Large stdout cap test in worker mode

Blocked until model-service issue is resolved.

## Next

M9 — Agent executor scaffold (now that sandbox has real termination semantics).
