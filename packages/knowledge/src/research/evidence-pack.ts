import type {
  EvidenceItem,
  EvidencePack,
  RankedResource,
  SourceUseCase,
} from "./source-types.js";
import { inferSourceUseCase } from "./query-builder.js";
import { verifyEvidenceClaims } from "./citation-verifier.js";
import { filterEvidence } from "./evidence-quality.js";

function isOfficial(tier: string) {
  return tier === "official_docs" || tier === "trusted_docs";
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function buildEvidencePack(input: {
  query: string;
  resourcesPlanned: RankedResource[];
  evidence: EvidenceItem[];
}): EvidencePack {
  const useCase: SourceUseCase = inferSourceUseCase(input.query);

  const { kept, qualityRejected, duplicateRejected } = filterEvidence(input.evidence);

  const citationVerification = verifyEvidenceClaims(kept);

  const uniqueSourceUrls = unique(kept.map((item) => item.url));
  const officialSourceUrls = unique(
    kept
      .filter((item) => isOfficial(item.tier))
      .map((item) => item.url)
  );

  const supportedClaimCount = citationVerification.filter(
    (item) => item.status === "supported"
  ).length;
  const weakClaimCount = citationVerification.filter(
    (item) => item.status === "weak"
  ).length;
  const unsupportedClaimCount = citationVerification.filter(
    (item) => item.status === "unsupported"
  ).length;

  const missing: string[] = [];

  if (kept.length === 0) {
    missing.push("No claim-level evidence was collected.");
  }

  if (
    (useCase === "api_facts" || useCase === "comparison") &&
    officialSourceUrls.length === 0
  ) {
    missing.push("No official/trusted sources were collected.");
  }

  if (kept.length > 0 && supportedClaimCount === 0) {
    missing.push("Evidence was collected, but no claim passed citation verification.");
  }

  return {
    query: input.query,
    useCase,
    resourcesPlanned: input.resourcesPlanned,
    evidence: kept,
    citationVerification,
    coverage: {
      hasEvidence: kept.length > 0,
      sourceCount: kept.length,
      claimCount: kept.length,
      uniqueSourceCount: uniqueSourceUrls.length,
      officialSourceCount: officialSourceUrls.length,
      supportedClaimCount,
      weakClaimCount,
      unsupportedClaimCount,
      rawClaimCount: input.evidence.length,
      filteredClaimCount: kept.length,
      qualityRejectedClaimCount: qualityRejected.length,
      duplicateRejectedClaimCount: duplicateRejected.length,
      missing,
    },
  };
}
