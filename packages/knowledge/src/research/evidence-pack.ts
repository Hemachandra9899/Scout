import type {
  EvidenceItem,
  EvidencePack,
  RankedResource,
  SourceUseCase,
} from "./source-types.js";
import { inferSourceUseCase } from "./query-builder.js";

function isOfficial(tier: string) {
  return tier === "official_docs" || tier === "trusted_docs";
}

export function buildEvidencePack(input: {
  query: string;
  resourcesPlanned: RankedResource[];
  evidence: EvidenceItem[];
}): EvidencePack {
  const useCase: SourceUseCase = inferSourceUseCase(input.query);

  const officialSourceCount = input.evidence.filter((item) =>
    isOfficial(item.tier)
  ).length;

  const missing: string[] = [];

  if (input.evidence.length === 0) {
    missing.push("No usable evidence was collected.");
  }

  if (
    (useCase === "api_facts" || useCase === "comparison") &&
    officialSourceCount === 0
  ) {
    missing.push("No official/trusted sources were collected.");
  }

  return {
    query: input.query,
    useCase,
    resourcesPlanned: input.resourcesPlanned,
    evidence: input.evidence,
    coverage: {
      hasEvidence: input.evidence.length > 0,
      sourceCount: input.evidence.length,
      officialSourceCount,
      missing,
    },
  };
}
