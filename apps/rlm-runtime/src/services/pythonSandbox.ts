import { loadPyodide } from "pyodide";
import type {
  PythonExecutionResult,
  SubAgentHandler,
  ToolHandler,
} from "../types.ts";

let pyodidePromise: Promise<any> | null = null;

async function getPyodide() {
  if (!pyodidePromise) {
    pyodidePromise = loadPyodide();
  }
  return pyodidePromise;
}

export class PythonSandbox {
  async execute(
    code: string,
    subAgentHandler: SubAgentHandler,
    toolHandler: ToolHandler
  ): Promise<PythonExecutionResult> {
    const pyodide = await getPyodide();

    pyodide.globals.set(
      "_rlm_query_js",
      async (prompt: string, context: unknown) => {
        return await subAgentHandler(String(prompt), context);
      }
    );

    pyodide.globals.set(
      "_rlm_tool_js",
      async (name: string, args: unknown) => {
        return await toolHandler(String(name), args as Record<string, unknown>);
      }
    );

    const wrappedCode = `
import sys
import io
import json
import traceback
from pyodide.ffi import to_js

_rlm_stdout = io.StringIO()
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

async def _rlm_user_main():
${this.indent(code)}

_old_stdout = sys.stdout
sys.stdout = _rlm_stdout

try:
    await _rlm_user_main()
except Exception:
    _rlm_error = traceback.format_exc()
finally:
    sys.stdout = _old_stdout

json.dumps({
    "stdout": _rlm_stdout.getvalue(),
    "final": _rlm_to_jsonable(_rlm_final_value),
    "finalCalled": _rlm_final_called,
    "error": _rlm_error,
    "toolCalls": _rlm_tool_calls
})`;

    try {
      const raw = await pyodide.runPythonAsync(wrappedCode);
      const parsed = JSON.parse(String(raw));

      return {
        stdout: String(parsed.stdout ?? ""),
        final: parsed.final ?? null,
        finalCalled: Boolean(parsed.finalCalled),
        error: parsed.error ?? null,
        toolCalls: Array.isArray(parsed.toolCalls) ? parsed.toolCalls.map(String) : [],
      };
    } catch (error) {
      return {
        stdout: "",
        final: null,
        finalCalled: false,
        error: error instanceof Error ? error.message : String(error),
        toolCalls: [],
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
