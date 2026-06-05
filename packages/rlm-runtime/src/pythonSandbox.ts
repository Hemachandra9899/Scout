import { loadPyodide, type PyodideInterface } from "pyodide";
import type { PythonExecutionResult, SubAgentHandler } from "./types.ts";

let pyodidePromise: Promise<PyodideInterface> | null = null;

async function getPyodide(): Promise<PyodideInterface> {
  if (!pyodidePromise) {
    pyodidePromise = loadPyodide();
  }
  return pyodidePromise;
}

export class PythonSandbox {
  async execute(
    code: string,
    subAgentHandler: SubAgentHandler,
  ): Promise<PythonExecutionResult> {
    const pyodide = await getPyodide();

    pyodide.globals.set(
      "_rlm_query_js",
      async (prompt: string, context: unknown) => {
        return await subAgentHandler(String(prompt), context);
      },
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

async def llm_query(prompt, context=None):
    result = await _rlm_query_js(prompt, to_js(context or {}))
    try:
        return result.to_py()
    except Exception:
        return result

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
${indent(code)}

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
    "error": _rlm_error
})
`;

    try {
      const raw = await pyodide.runPythonAsync(wrappedCode);
      const parsed = JSON.parse(String(raw));

      return {
        stdout: String(parsed.stdout ?? ""),
        final: parsed.final ?? null,
        finalCalled: Boolean(parsed.finalCalled),
        error: parsed.error ?? null,
      };
    } catch (error) {
      return {
        stdout: "",
        final: null,
        finalCalled: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

function indent(code: string): string {
  return code
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
}
