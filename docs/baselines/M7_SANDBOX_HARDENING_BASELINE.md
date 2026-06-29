# M7 — Sandbox Hardening Baseline

**Commit**: TBD (will update after final commit)
**Date**: 2026-06-29
**Author**: Teja

## Changes

### C1 — Types (`apps/rlm-runtime/src/types.ts`)
- Added `SandboxBudget` type: `timeoutMs`, `maxStdoutChars`, `maxStderrChars`, `maxToolCalls`
- Added `SandboxSafetyDebug` type: `budget`, `timedOut`, `killed`, `stdoutSize`, `stderrSize`, `stdoutTruncated`, `stderrTruncated`, `toolCallCount`, `toolCallLimitHit`, `isolationMode`
- Extended `PythonExecutionResult` with `stderr?: string`, `safety?: SandboxSafetyDebug`
- Extended `RlmRunDebug` with `sandboxSafety?: SandboxSafetyDebug`

### C2 — Budget wiring (`apps/rlm-runtime/src/services/rlmLoop.ts`)
- Added `getSandboxBudget()` helper that reads budget from env vars:
  - `RLM_SANDBOX_TIMEOUT_MS` (default 30000)
  - `RLM_SANDBOX_MAX_STDOUT_CHARS` (default 20000)
  - `RLM_SANDBOX_MAX_STDERR_CHARS` (default 10000)
  - `RLM_SANDBOX_MAX_TOOL_CALLS` (default 12)
- Wired budget into both `sandbox.execute()` call sites (main loop + `tryToolFirstPath`)
- `execute()` signature changed: old `execute(code, subAgentHandler, toolHandler)` → new `execute(code, { budget?, subAgentHandler?, toolHandler? })` with backward compat

### C3 — Capped stdout/stderr (`apps/rlm-runtime/src/services/pythonSandbox.ts`)
- Injects `_RlmCappedWriter` into Python stdlib replacements for `sys.stdout` and `sys.stderr`
- Writers track character count and truncation flag
- Size and truncation returned in `SandboxSafetyDebug`

### C4 — Tool-call budget + soft timeout + isolation
- `_rlm_tool_js` wrapper increments counter and throws when `toolCallCount > maxToolCalls`
- `withTimeout()` wraps `pyodide.runPythonAsync()` with `Promise.race` for soft timeout
- If timed out: sets `timedOut: true` and `error` message; execution context is NOT killed
- Isolation via `exec(code, _rlm_user_globals, _rlm_user_globals)` with fresh namespace
- No `sys.modules.clear()` (would break Pyodide internals)

### C5 — Safety debug return
- `execute()` returns complete `SandboxSafetyDebug` in result:
  - `stdoutSize`, `stderrSize`, `stdoutTruncated`, `stderrTruncated`
  - `toolCallCount`, `toolCallLimitHit`
  - `timedOut`, `killed`
  - `isolationMode` (always `"best_effort_globals"`)
- Both success and error paths populate safety

### C6 — Harness signals + regression case
- Added to `run-eval.mjs` and `harness-trajectory.mjs`:
  - `sandboxTimedOut`, `sandboxKilled`, `sandboxStdoutTruncated`, `sandboxStderrTruncated`, `sandboxToolCallLimitHit`, `sandboxToolCallCount`
- Added to `analyze-run.mjs` phase2 counts
- Added `011-sandbox-hardening.json` regression case

## Design Decisions

| Decision | Rationale |
|---|---|
| Soft timeout (not hard kill) | Pyodide runs in-process; true hard kill needs Worker/process isolation (M8) |
| `best_effort_globals` isolation | `exec()` with fresh namespace prevents most variable leakage; no `sys.modules.clear()` |
| Backward-compat `execute()` | Accept both old positional args and new options object |
| Budget from env vars | Easy tuning per deployment | 12 default tool calls | Matches existing `maxSteps * maxToolCallsPerStep` patterns |

## Typecheck

- `apps/rlm-runtime/src/types.ts` — PASS
- `apps/rlm-runtime/src/services/pythonSandbox.ts` — PASS
- `apps/rlm-runtime/src/services/rlmLoop.ts` — PASS

## Gate Results

*(To be filled after final testing)*

| Gate | Result |
|---|---|
| `eval:ci` | |
| `eval:phase2` | |
| `eval:phase3` | |
| `eval:routing-intent` | |
| `typecheck:api` | |
| `typecheck:knowledge` | |
| `typecheck:web` | |

## Known Limitations

1. **Timeout is soft**: CPU-bound Python code continues executing after `Promise.race` returns. The timeout signal is returned but the process is not killed.
2. **Isolation is best-effort**: A motivated Python snippet could escape `exec()` namespace isolation. Full isolation requires Worker/process boundary.
3. **No stderr capture for subprocesses**: Only Python `sys.stderr` is captured; subprocess stderr is not.
4. **Capped writers don't warn**: Truncation is silent (detectable via `stdoutTruncated`/`stderrTruncated` flags).
