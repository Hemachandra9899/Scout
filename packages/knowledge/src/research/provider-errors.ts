export type ProviderErrorKind =
  | "quota"
  | "rate_limit"
  | "auth"
  | "network"
  | "unknown";

export function classifyProviderError(error: unknown): ProviderErrorKind {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : JSON.stringify(error ?? "");

  const normalized = message.toLowerCase();

  if (
    normalized.includes("quota") ||
    normalized.includes("credit") ||
    normalized.includes("billing") ||
    normalized.includes("payment") ||
    normalized.includes("402")
  ) {
    return "quota";
  }

  if (
    normalized.includes("rate limit") ||
    normalized.includes("too many requests") ||
    normalized.includes("429")
  ) {
    return "rate_limit";
  }

  if (
    normalized.includes("unauthorized") ||
    normalized.includes("forbidden") ||
    normalized.includes("invalid api key") ||
    normalized.includes("401") ||
    normalized.includes("403")
  ) {
    return "auth";
  }

  if (
    normalized.includes("timeout") ||
    normalized.includes("econnreset") ||
    normalized.includes("network") ||
    normalized.includes("fetch failed")
  ) {
    return "network";
  }

  return "unknown";
}

export function isProviderExhausted(error: unknown): boolean {
  const kind = classifyProviderError(error);
  return kind === "quota" || kind === "rate_limit";
}
