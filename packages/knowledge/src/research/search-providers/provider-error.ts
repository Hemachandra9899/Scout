import type { SearchProviderName } from "./types.js";

/**
 * How a provider failed. `exhausted` means quota/credit/rate-limit — the provider
 * should be skipped for the rest of the run while others continue. `auth` means a
 * bad/expired key. `error` is any other transient/unknown failure.
 */
export type ProviderErrorKind = "exhausted" | "auth" | "error";

export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    readonly provider: SearchProviderName,
    readonly status?: number,
    message?: string,
  ) {
    super(message ?? `${provider} search failed (${kind})`);
    this.name = "ProviderError";
  }
}

const EXHAUSTED_PATTERN =
  /\b(quota|credit|insufficient|payment required|rate.?limit|too many requests|429|402)\b/i;

/** Classify an HTTP failure into a provider error kind. Body text wins over status. */
export function classifyProviderFailure(
  status: number,
  bodyText = "",
): ProviderErrorKind {
  if (EXHAUSTED_PATTERN.test(bodyText)) return "exhausted";
  if (status === 402 || status === 429) return "exhausted";
  if (status === 401 || status === 403) return "auth";
  return "error";
}

/** Build a typed ProviderError from a non-ok Response (consumes the body). */
export async function providerErrorFromResponse(
  provider: SearchProviderName,
  response: Response,
): Promise<ProviderError> {
  const body = await response.text().catch(() => "");
  const kind = classifyProviderFailure(response.status, body);
  return new ProviderError(
    kind,
    provider,
    response.status,
    `${provider} search failed: ${response.status} ${kind}`,
  );
}
