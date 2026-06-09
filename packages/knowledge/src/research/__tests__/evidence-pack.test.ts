import { describe, expect, it } from "vitest";
import { buildEvidencePack } from "../evidence-pack.js";
import type { EvidenceItem, RankedResource } from "../source-types.js";

function evidenceItem(overrides: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    claim: "Example API requires OAuth access tokens for authenticated API requests and secure data access.",
    quote: "Example API requires OAuth access tokens for authenticated API requests and secure data access.",
    title: "API Auth Docs",
    url: "https://docs.example.com/auth",
    section: "Authentication",
    tier: "official_docs",
    confidence: 0.92,
    entities: ["Example API", "OAuth"],
    reason: "Official docs",
    domain: "docs.example.com",
    product: "Example API",
    ...overrides,
  };
}

function resource(overrides: Partial<RankedResource> = {}): RankedResource {
  return {
    title: "Example API Docs",
    url: "https://docs.example.com",
    tier: "official_docs",
    score: 100,
    source: "registry",
    reason: "Official docs",
    matchedBy: ["registry"],
    ...overrides,
  };
}

describe("buildEvidencePack with quality filtering", () => {
  it("filters low-quality evidence and includes new coverage counts", () => {
    const good = evidenceItem();
    const bad = evidenceItem({
      claim: "Click here for more information about the API.",
      entities: [],
      tier: "media",
    });

    const pack = buildEvidencePack({
      query: "How does Example API auth work?",
      resourcesPlanned: [resource()],
      evidence: [good, bad],
    });

    expect(pack.evidence).toHaveLength(1);
    expect(pack.coverage.rawClaimCount).toBe(2);
    expect(pack.coverage.filteredClaimCount).toBe(1);
    expect(pack.coverage.qualityRejectedClaimCount).toBe(1);
    expect(pack.coverage.duplicateRejectedClaimCount).toBe(0);
    expect(pack.coverage.claimCount).toBe(1);
  });

  it("removes near-duplicate claims", () => {
    const first = evidenceItem();
    const second = evidenceItem({
      claim: "Example API requires OAuth access tokens for authenticated API requests and secure data access to resources.",
      url: "https://docs.example.com/auth/v2",
    });

    const pack = buildEvidencePack({
      query: "How does Example API auth work?",
      resourcesPlanned: [resource()],
      evidence: [first, second],
    });

    expect(pack.evidence).toHaveLength(1);
    expect(pack.coverage.rawClaimCount).toBe(2);
    expect(pack.coverage.filteredClaimCount).toBe(1);
    expect(pack.coverage.duplicateRejectedClaimCount).toBe(1);
  });

  it("annotates kept evidence with evidenceQuality metadata", () => {
    const good = evidenceItem();

    const pack = buildEvidencePack({
      query: "How does Example API auth work?",
      resourcesPlanned: [resource()],
      evidence: [good],
    });

    expect(pack.evidence[0].metadata?.evidenceQuality).toBeDefined();
  });

  it("citation verification runs on filtered evidence only", () => {
    const good = evidenceItem();
    const bad = evidenceItem({
      claim: "Read the documentation for more details on API configuration and setup.",
      entities: [],
      tier: "media",
    });

    const pack = buildEvidencePack({
      query: "How does Example API auth work?",
      resourcesPlanned: [resource()],
      evidence: [good, bad],
    });

    expect(pack.citationVerification).toHaveLength(1);
    expect(pack.citationVerification[0].claim).toBe(good.claim);
  });

  it("handles empty evidence input", () => {
    const pack = buildEvidencePack({
      query: "test",
      resourcesPlanned: [resource()],
      evidence: [],
    });

    expect(pack.evidence).toHaveLength(0);
    expect(pack.coverage.rawClaimCount).toBe(0);
    expect(pack.coverage.filteredClaimCount).toBe(0);
    expect(pack.coverage.qualityRejectedClaimCount).toBe(0);
    expect(pack.coverage.duplicateRejectedClaimCount).toBe(0);
    expect(pack.coverage.hasEvidence).toBe(false);
  });
});
