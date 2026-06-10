import type { ResearchJob } from "./api";

export type ResearchContractUi = {
  status?: string;
  query?: string;
  normalizedQuery?: string;
  answerMarkdown?: string;
  citations?: Array<Record<string, any>>;
  confidence?: number;
  answerMode?: string;
  groundingStatus?: string;
  groundingIssues?: Array<Record<string, any>>;
  evidenceCoverage?: Record<string, any>;
  crawlTrace?: Record<string, any>;
  skippedCrawls?: Array<Record<string, any>>;
  resources?: Array<Record<string, any>>;
  warnings?: string[];
};

export type ResearchContractDebug = {
  search?: Record<string, any>;
  crawl?: Record<string, any>;
  evidence?: Record<string, any>;
  answer?: Record<string, any>;
  memories?: Record<string, any>;
};

export type ResearchContract = {
  contractVersion: string;
  ui?: ResearchContractUi;
  debug?: ResearchContractDebug;
  [key: string]: any;
};

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isResearchContract(value: unknown): value is ResearchContract {
  return isRecord(value) && value.contractVersion === "research-response-v1";
}

function searchNestedContract(value: unknown, depth = 0): ResearchContract | undefined {
  if (depth > 4) return undefined;
  if (isResearchContract(value)) return value;
  if (!isRecord(value)) return undefined;

  const preferredKeys = [
    "result",
    "finalOutput",
    "final",
    "output",
    "response",
    "data",
    "research",
  ];

  for (const key of preferredKeys) {
    const nested = searchNestedContract(value[key], depth + 1);
    if (nested) return nested;
  }

  for (const nestedValue of Object.values(value)) {
    const nested = searchNestedContract(nestedValue, depth + 1);
    if (nested) return nested;
  }

  return undefined;
}

export function getResearchContract(job?: ResearchJob): ResearchContract | undefined {
  if (!job) return undefined;

  for (const report of job.reports ?? []) {
    const metadata = report.metadata;
    const fromMetadata = searchNestedContract(metadata);
    if (fromMetadata) return fromMetadata;
  }

  for (const run of job.agentRuns ?? []) {
    const fromRun = searchNestedContract(run.finalOutput);
    if (fromRun) return fromRun;

    for (const step of run.steps ?? []) {
      const fromStepResult = searchNestedContract(step.result);
      if (fromStepResult) return fromStepResult;

      if (typeof step.stdout === "string") {
        try {
          const parsed = JSON.parse(step.stdout);
          const fromStdout = searchNestedContract(parsed);
          if (fromStdout) return fromStdout;
        } catch {
          // stdout is often plain text; ignore parse failures.
        }
      }
    }
  }

  return undefined;
}

export function getContractAnswerMarkdown(job?: ResearchJob): string {
  const contract = getResearchContract(job);
  return contract?.ui?.answerMarkdown?.trim() || "";
}

export function getContractSources(job?: ResearchJob): Array<Record<string, any>> {
  const contract = getResearchContract(job);
  const citations = contract?.ui?.citations;
  if (Array.isArray(citations) && citations.length > 0) return citations;

  const resources = contract?.ui?.resources;
  if (Array.isArray(resources) && resources.length > 0) return resources;

  return [];
}

export function hasResearchContract(job?: ResearchJob): boolean {
  return Boolean(getResearchContract(job));
}
