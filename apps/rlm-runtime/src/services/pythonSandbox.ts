import { loadPyodide } from "pyodide";
import type {
  PythonExecutionResult,
  SandboxBudget,
  SandboxSafetyDebug,
  SubAgentHandler,
  ToolHandler,
} from "../types.ts";

let pyodidePromise: Promise<any> | null = null;

const DEFAULT_SANDBOX_BUDGET: SandboxBudget = {
  timeoutMs: 30_000,
  maxStdoutChars: 20_000,
  maxStderrChars: 10_000,
  maxToolCalls: 12,
};

async function getPyodide() {
  if (!pyodidePromise) {
    pyodidePromise = loadPyodide();
  }
  return pyodidePromise;
}

function resolveBudget(input?: Partial<SandboxBudget>): SandboxBudget {
  return { ...DEFAULT_SANDBOX_BUDGET, ...(input ?? {}) };
}

type ExecuteOptions = {
  budget?: Partial<SandboxBudget>;
  subAgentHandler?: SubAgentHandler;
  toolHandler?: ToolHandler;
};

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<{ timedOut: false; value: T } | { timedOut: true }> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<{ timedOut: true }>((resolve) => {
    timeout = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
  });
  return Promise.race([
    promise.then((value) => ({ timedOut: false as const, value })),
    timeoutPromise,
  ]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

export class PythonSandbox {
  async execute(
    code: string,
    optionsOrHandler?: ExecuteOptions | SubAgentHandler,
    legacyToolHandler?: ToolHandler,
  ): Promise<PythonExecutionResult> {
    const pyodide = await getPyodide();

    let options: ExecuteOptions;
    if (typeof optionsOrHandler === "function") {
      options = { subAgentHandler: optionsOrHandler, toolHandler: legacyToolHandler };
    } else {
      options = optionsOrHandler ?? {};
    }

    const budget = resolveBudget(options?.budget);
    const subAgentHandler = options.subAgentHandler;
    const toolHandler = options.toolHandler;

    let toolCallCount = 0;
    let toolCallLimitHit = false;

    const bridgeQueryJs = subAgentHandler
      ? async (prompt: string, context: unknown) => {
          return await subAgentHandler(String(prompt), context);
        }
      : null;

    const callToolWithBudget = toolHandler
      ? async (name: string, args: unknown) => {
          toolCallCount += 1;
          if (toolCallCount > budget.maxToolCalls) {
            toolCallLimitHit = true;
            throw new Error(
              `Sandbox tool-call budget exceeded: ${budget.maxToolCalls}`,
            );
          }
          return await toolHandler(String(name), args as Record<string, unknown>);
        }
      : null;

    const cappedWriterCode = `
import sys

class _RlmCappedWriter:
    def __init__(self, limit):
        self.limit = int(limit)
        self.parts = []
        self.size = 0
        self.truncated = False

    def write(self, value):
        value = str(value)
        remaining = self.limit - self.size
        if remaining <= 0:
            self.truncated = True
            return 0
        chunk = value[:remaining]
        self.parts.append(chunk)
        self.size += len(chunk)
        if len(value) > remaining:
            self.truncated = True
        return len(value)

    def flush(self):
        pass

    def getvalue(self):
        return "".join(self.parts)

_rlm_stdout = _RlmCappedWriter(${budget.maxStdoutChars})
_rlm_stderr = _RlmCappedWriter(${budget.maxStderrChars})
sys.stdout = _rlm_stdout
sys.stderr = _rlm_stderr
`;

    pyodide.globals.set("_rlm_stdout_limit", budget.maxStdoutChars);
    pyodide.globals.set("_rlm_stderr_limit", budget.maxStderrChars);

    await pyodide.runPythonAsync(cappedWriterCode);

    if (bridgeQueryJs) {
      pyodide.globals.set("_rlm_query_js", bridgeQueryJs);
    }

    if (callToolWithBudget) {
      pyodide.globals.set("_rlm_tool_js", callToolWithBudget);
    }

    const toolWrappersCode = `
import sys
import io
import json
import traceback
from pyodide.ffi import to_js

_rlm_final_called = False
_rlm_final_value = None
_rlm_error = None
_rlm_tool_calls = []

def _to_py(value):
    try:
        return value.to_py()
    except Exception:
        return value

async def llm_query(prompt, context=None):
    result = await _rlm_query_js(prompt, to_js(context or {}))
    return _to_py(result)

async def crawl_url(url, max_pages=1):
    _rlm_tool_calls.append("crawl_url")
    result = await _rlm_tool_js("crawl_url", to_js({
        "url": url,
        "maxPages": max_pages
    }))
    return _to_py(result)

async def search_kb(query, top_k=5):
    _rlm_tool_calls.append("search_kb")
    result = await _rlm_tool_js("search_kb", to_js({
        "query": query,
        "topK": top_k
    }))
    data = _to_py(result)
    if isinstance(data, dict) and "results" in data:
        return data["results"]
    return data

async def web_research(query, max_results=3, max_pages_per_source=1, max_total_pages=5, max_depth=1):
    _rlm_tool_calls.append("web_research")
    result = await _rlm_tool_js("web_research", to_js({
        "query": query,
        "maxResults": max_results,
        "maxPagesPerSource": max_pages_per_source,
        "maxTotalPages": max_total_pages,
        "maxDepth": max_depth,
        "useOrchestrator": True
    }))
    return _to_py(result)

async def github_repo(url, mode="summary", max_files=30):
    _rlm_tool_calls.append("github_repo")
    result = await _rlm_tool_js("github_repo", to_js({"url": url, "mode": mode, "maxFiles": max_files}))
    return _to_py(result)

async def query_graph(query, depth=1):
    _rlm_tool_calls.append("query_graph")
    result = await _rlm_tool_js("query_graph", to_js({
        "query": query,
        "depth": depth
    }))
    data = _to_py(result)
    if isinstance(data, dict):
        return {
            "entities": data.get("entities", []),
            "relations": data.get("relations", []),
            "raw": data,
        }
    return data

def final(value=None):
    global _rlm_final_called, _rlm_final_value
    _rlm_final_called = True
    _rlm_final_value = value

def _rlm_to_jsonable(value):
    try:
        json.dumps(value)
        return value
    except Exception:
        return str(value)

_rlm_user_tools = {
    "final": final,
    "crawl_url": crawl_url,
    "web_research": web_research,
    "search_kb": search_kb,
    "github_repo": github_repo,
    "query_graph": query_graph,
    "llm_query": llm_query,
}
`;

    await pyodide.runPythonAsync(toolWrappersCode);

    const userCode = `${this.indent(code)}`;

    const runnerCode = `
_rlm_user_globals = {
    "__name__": "__rlm_run__",
    "__builtins__": __builtins__,
    **_rlm_user_tools,
}
exec(${JSON.stringify(code)}, _rlm_user_globals, _rlm_user_globals)
`;

    try {
      const timedExecution = await withTimeout(
        pyodide.runPythonAsync(runnerCode),
        budget.timeoutMs,
      );

      const stdoutResult = pyodide.runPython("_rlm_stdout.getvalue()");
      const stderrResult = pyodide.runPython("_rlm_stderr.getvalue()");
      const stdout = String(stdoutResult ?? "");
      const stderr = String(stderrResult ?? "");

      const rawSizeStdout = pyodide.runPython("_rlm_stdout.size");
      const rawSizeStderr = pyodide.runPython("_rlm_stderr.size");
      const stdoutSize = Number(rawSizeStdout ?? 0);
      const stderrSize = Number(rawSizeStderr ?? 0);
      const stdoutTruncated = Boolean(pyodide.runPython("_rlm_stdout.truncated"));
      const stderrTruncated = Boolean(pyodide.runPython("_rlm_stderr.truncated"));

      let final: unknown = null;
      let finalCalled = false;
      let error: string | null = null;
      let toolCalls: string[] = [];

      let timedOut = false;
      let killed = false;

      if (timedExecution.timedOut) {
        timedOut = true;
        error = `Sandbox execution timed out after ${budget.timeoutMs}ms.`;
      } else {
        const rawFinal = pyodide.runPython("_rlm_to_jsonable(_rlm_final_value)");
        final = rawFinal ?? null;
        finalCalled = Boolean(pyodide.runPython("_rlm_final_called"));
        const rawError = pyodide.runPython("_rlm_error");
        error = rawError ? String(rawError) : null;
        const rawToolCalls = pyodide.runPython("_rlm_tool_calls");
        toolCalls = Array.isArray(rawToolCalls) ? rawToolCalls.map(String) : [];
      }

      const safety: SandboxSafetyDebug = {
        budget,
        timedOut,
        killed,
        stdoutSize,
        stderrSize,
        stdoutTruncated,
        stderrTruncated,
        toolCallCount,
        toolCallLimitHit,
        isolationMode: "best_effort_globals",
      };

      return {
        stdout,
        stderr,
        final,
        finalCalled,
        error,
        toolCalls,
        safety,
      };
    } catch (error) {
      const stdoutResult = pyodide.runPython("_rlm_stdout.getvalue()");
      const stderrResult = pyodide.runPython("_rlm_stderr.getvalue()");
      const stdout = String(stdoutResult ?? "");
      const stderr = String(stderrResult ?? "");

      const safety: SandboxSafetyDebug = {
        budget,
        timedOut: false,
        killed: false,
        stdoutSize: stdout.length,
        stderrSize: stderr.length,
        stdoutTruncated: false,
        stderrTruncated: false,
        toolCallCount,
        toolCallLimitHit,
        isolationMode: "best_effort_globals",
      };

      return {
        stdout,
        stderr,
        final: null,
        finalCalled: false,
        error: error instanceof Error ? error.message : String(error),
        toolCalls: [],
        safety,
      };
    }
  }

  private indent(code: string): string {
    return code
      .split("\n")
      .map((line) => `    ${line}`)
      .join("\n");
  }
}
