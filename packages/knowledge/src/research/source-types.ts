export type SourceTier =
  | "official_docs"
  | "trusted_docs"
  | "reference_examples"
  | "community"
  | "media"
  | "unknown";

export type SourceUseCase =
  | "api_facts"
  | "comparison"
  | "implementation_help"
  | "tutorial"
  | "general_research";

export type ResourceCandidate = {
  title: string;
  url: string;
  product?: string;
  domain?: string;
  tier: SourceTier;
  topics?: string[];
  keywords?: string[];
  reason: string;
  source: "registry" | "web_search" | "user_url";
};

export type RankedResource = ResourceCandidate & {
  score: number;
  matchedBy: string[];
};

export type EvidenceItem = {
  title: string;
  url: string;
  product?: string;
  domain?: string;
  tier: SourceTier;
  text: string;
  reason: string;
};

export type EvidencePack = {
  query: string;
  useCase: SourceUseCase;
  resourcesPlanned: RankedResource[];
  evidence: EvidenceItem[];
  coverage: {
    hasEvidence: boolean;
    sourceCount: number;
    officialSourceCount: number;
    missing: string[];
  };
};
