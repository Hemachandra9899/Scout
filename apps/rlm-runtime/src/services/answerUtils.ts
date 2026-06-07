import type { AnswerSource, RlmStep } from "../types.ts";

export function looksLikeNumericDump(text: string): boolean {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 3) return false;

  const numericLines = lines.filter((l) => {
    const digits = (l.match(/\d/g) || []).length;
    return digits > 0 && digits / l.length > 0.2;
  });

  const currencyValues = (text.match(/[\$€£¥]\s*\d+(?:,\d{3})*(?:\.\d+)?/g) || []).length;
  const percentages = (text.match(/\d+(?:\.\d+)?%/g) || []).length;
  const tableRows = (text.match(/^\|.+\|$/gm) || []).length;

  return (
    (numericLines.length / lines.length) > 0.35 ||
    currencyValues > 15 ||
    percentages > 15 ||
    (tableRows > 20 && numericLines.length / lines.length > 0.25)
  );
}

export function isGenericOrRawAnswer(value: unknown): boolean {
  if (value === null || value === undefined) return true;

  if (Array.isArray(value)) return true;

  if (typeof value === "object") return true;

  if (typeof value !== "string") return false;

  const text = value.trim();
  const lower = text.toLowerCase();

  if (!text) return true;

  if (
    [
      "done",
      "completed",
      "all questions have been answered",
      "all questions have been answered.",
      "task complete",
      "the task is complete.",
    ].includes(lower)
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

  if (placeholderPatterns.some((p) => lower.includes(p))) {
    return true;
  }

  const rawMarkers = [
    "chunkId",
    "documentId",
    "sourceUrl",
    "retrieval",
    "metadata",
    "[{",
    "{'",
    "'chunkId'",
    "'sourceUrl'",
  ];

  if (rawMarkers.some((marker) => text.includes(marker))) {
    return true;
  }

  return looksLikeNumericDump(text);
}

export function readable(value: unknown): string {
  if (value === null || value === undefined) return "";

  if (typeof value === "string") return value;

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function sourceKey(source: AnswerSource): string {
  return `${source.title || ""}::${source.url || ""}`;
}

function pushSource(sources: AnswerSource[], source: AnswerSource) {
  if (!source.url && !source.title) return;

  const exists = sources.some((item) => sourceKey(item) === sourceKey(source));
  if (!exists) sources.push(source);
}

function visit(value: unknown, sources: AnswerSource[]) {
  if (!value) return;

  if (Array.isArray(value)) {
    for (const item of value) visit(item, sources);
    return;
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;

    const title =
      typeof obj.title === "string"
        ? obj.title
        : typeof obj.sourceTitle === "string"
          ? obj.sourceTitle
          : null;

    const url =
      typeof obj.sourceUrl === "string"
        ? obj.sourceUrl
        : typeof obj.url === "string"
          ? obj.url
          : null;

    if (title || url) {
      pushSource(sources, {
        title,
        url,
        score: typeof obj.score === "number" ? obj.score : null,
        retrieval: typeof obj.retrieval === "string" ? obj.retrieval : null,
      });
    }

    for (const child of Object.values(obj)) visit(child, sources);
  }
}

function isWeakUrl(url?: string | null) {
  if (!url) return false;

  try {
    const host = new URL(url).hostname.replace(/^www\./, "");

    return [
      "youtube.com",
      "youtu.be",
      "postman.com",
      "stackoverflow.com",
      "reddit.com",
      "medium.com",
    ].some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

function sourceRank(url?: string | null) {
  if (!url) return 0;

  try {
    const host = new URL(url).hostname.replace(/^www\./, "");

    if (
      [
        "developers.facebook.com",
        "developers.google.com",
        "business-api.tiktok.com",
        "ads.tiktok.com",
      ].some((domain) => host === domain || host.endsWith(`.${domain}`))
    ) {
      return 100;
    }

    if (isWeakUrl(url)) return 1;

    return 40;
  } catch {
    return 0;
  }
}

export function extractSources(final: unknown, steps: RlmStep[]): AnswerSource[] {
  const sources: AnswerSource[] = [];

  visit(final, sources);

  for (const step of steps) {
    visit(step.final, sources);

    if (step.stdout) {
      const urls = step.stdout.match(/https?:\/\/[^\s'",}]+/g) || [];
      for (const url of urls) {
        pushSource(sources, {
          title: null,
          url,
          score: null,
          retrieval: null,
        });
      }
    }
  }

  return sources
    .filter((source) => !isWeakUrl(source.url))
    .sort((a, b) => sourceRank(b.url) - sourceRank(a.url))
    .slice(0, 8);
}