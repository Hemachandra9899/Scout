import { createHash } from "node:crypto";

export function cacheKey(...parts: string[]): string {
  const hash = createHash("sha256")
    .update(parts.join("|"))
    .digest("hex");
  return hash;
}

export function fetchUrlCacheKey(url: string): string {
  return cacheKey("fetchUrlText", url);
}

export function searchCacheKey(query: string, limit: number, routeKind: string): string {
  return cacheKey("searchResourceCandidates", query, String(limit), routeKind);
}

export function graphReportCacheKey(input: { projectId?: string; reportId?: string }): string {
  if (input.reportId) return cacheKey("graphReportById", input.reportId);
  return cacheKey("getLatestGraphReport", input.projectId ?? "");
}
