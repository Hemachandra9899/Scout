export function readable(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function isGenericFinal(value: unknown): boolean {
  if (typeof value !== "string") return false;

  const normalized = value.trim().toLowerCase();

  if (
    [
      "done",
      "completed",
      "all questions have been answered.",
      "all questions have been answered",
      "the task is complete.",
      "task complete",
    ].includes(normalized)
  ) {
    return true;
  }

  const placeholderPatterns = [
    "the comparison table",
    "the table above",
    "as shown above",
    "are provided above",
    "is provided above",
    "see above",
    "refer to the",
    "see the table",
  ];

  return placeholderPatterns.some((p) => normalized.includes(p));
}

function lastUsefulStdout(result: any): string {
  const steps = Array.isArray(result?.steps) ? result.steps : [];

  for (const step of [...steps].reverse()) {
    const stdout = typeof step?.stdout === "string" ? step.stdout.trim() : "";

    if (stdout && !stdout.toLowerCase().includes("an error occurred: 0")) {
      return stdout;
    }
  }

  for (const step of [...steps].reverse()) {
    const stdout = typeof step?.stdout === "string" ? step.stdout.trim() : "";

    if (stdout) {
      return stdout;
    }
  }

  return "";
}

export function extractUserAnswer(result: any): string {
  const finalValue = result?.final;

  if (finalValue !== undefined && finalValue !== null && !isGenericFinal(finalValue)) {
    return readable(finalValue);
  }

  const stdout = lastUsefulStdout(result);

  if (stdout) {
    return stdout;
  }

  if (result?.error) {
    return readable(result.error);
  }

  return readable(finalValue || result);
}
