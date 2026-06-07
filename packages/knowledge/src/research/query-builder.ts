import type { SourceUseCase } from "./source-types.js";

export function normalizeResearchQuery(query: string): string {
  return query
    .replace(/\bmets\s+graph\s+api\b/gi, "Meta Graph API")
    .replace(/\bmeta\s+ads\s+api\b/gi, "Meta Marketing API")
    .replace(/\bfacebook\s+ads\s+api\b/gi, "Meta Marketing API")
    .trim();
}

export function inferSourceUseCase(query: string): SourceUseCase {
  const q = query.toLowerCase();

  if (/\b(compare|comparison|vs|versus|difference|matrix)\b/.test(q)) {
    return "comparison";
  }

  if (/\b(api|endpoint|permission|oauth|quota|rate limit|field|pricing|docs|documentation)\b/.test(q)) {
    return "api_facts";
  }

  if (/\b(error|bug|fix|workaround|not working|debug|issue)\b/.test(q)) {
    return "implementation_help";
  }

  if (/\b(how to|tutorial|example|sample|guide)\b/.test(q)) {
    return "tutorial";
  }

  return "general_research";
}

export function buildFallbackSearchQueries(query: string): string[] {
  const normalized = normalizeResearchQuery(query);
  const useCase = inferSourceUseCase(normalized);

  if (useCase === "api_facts" || useCase === "comparison") {
    return [
      `${normalized} official documentation`,
      `${normalized} API reference official docs`,
      `${normalized} permissions rate limits official docs`,
    ];
  }

  if (useCase === "implementation_help") {
    return [
      `${normalized} official docs`,
      `${normalized} GitHub issue`,
      `${normalized} StackOverflow fix`,
    ];
  }

  return [`${normalized} official docs`, `${normalized} documentation`];
}
