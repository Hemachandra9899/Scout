import { describe, expect, it } from "vitest";
import { scoreEvidenceItem, filterEvidence } from "../evidence-quality.js";
import type { EvidenceItem } from "../source-types.js";

function item(overrides: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    claim: "Example API requires OAuth access tokens for authenticated requests.",
    quote: "Example API requires OAuth access tokens for authenticated requests.",
    title: "API Auth Docs",
    url: "https://docs.example.com/auth",
    tier: "official_docs",
    confidence: 0.92,
    entities: ["Example API", "OAuth"],
    reason: "Official docs",
    domain: "docs.example.com",
    product: "Example API",
    ...overrides,
  };
}

describe("scoreEvidenceItem", () => {
  it("scores high for specific technical claims from official docs", () => {
    const score = scoreEvidenceItem(item());
    expect(score.total).toBeGreaterThanOrEqual(50);
    expect(score.specificity).toBeGreaterThanOrEqual(10);
    expect(score.authority).toBe(25);
    expect(score.domainSignal).toBeGreaterThanOrEqual(3);
  });

  it("scores low for generic short claims", () => {
    const score = scoreEvidenceItem(
      item({
        claim: "Click here for more information.",
        entities: [],
        tier: "media",
      })
    );
    expect(score.total).toBeLessThan(40);
    expect(score.flags).toContain("navigation_like");
    expect(score.flags).toContain("too_short");
  });

  it("scores low for community tier without entities", () => {
    const score = scoreEvidenceItem(
      item({
        claim: "a generic statement without any specific technical terms or named entities in this content at all for testing",
        entities: [],
        tier: "community",
      })
    );
    expect(score.total).toBeLessThan(40);
    expect(score.flags).toContain("no_entities");
  });

  it("rejects claims with navigation patterns", () => {
    const score = scoreEvidenceItem(
      item({
        claim: "Visit the documentation page for more details about the API.",
        entities: ["API"],
        tier: "official_docs",
      })
    );
    expect(score.flags).toContain("navigation_like");
    expect(score.total).toBeLessThanOrEqual(20);
  });

  it("boosts section quality for api reference headings", () => {
    const score = scoreEvidenceItem(
      item({ section: "Authentication" })
    );
    expect(score.sectionQuality).toBe(15);
  });

  it("default section quality for unknown headings", () => {
    const score = scoreEvidenceItem(
      item({ section: "Introduction" })
    );
    expect(score.sectionQuality).toBe(10);
  });

  it("assigns default section quality when no section provided", () => {
    const score = scoreEvidenceItem(item({ section: undefined }));
    expect(score.sectionQuality).toBe(5);
  });

  it("awards authority points based on tier", () => {
    expect(scoreEvidenceItem(item({ tier: "official_docs" })).authority).toBe(25);
    expect(scoreEvidenceItem(item({ tier: "trusted_docs" })).authority).toBe(20);
    expect(scoreEvidenceItem(item({ tier: "community" })).authority).toBe(8);
    expect(scoreEvidenceItem(item({ tier: "media" })).authority).toBe(6);
  });

  it("detects domain signal from technical terms", () => {
    const score = scoreEvidenceItem(
      item({
        claim:
          "The REST API endpoint requires OAuth token authentication for each request to access protected resources.",
        entities: ["REST API", "OAuth"],
      })
    );
    expect(score.domainSignal).toBeGreaterThanOrEqual(14);
  });
});

describe("filterEvidence", () => {
  it("keeps high-quality claims and rejects low-quality ones", () => {
    const good: EvidenceItem = item({
      claim:
        "The REST API supports OAuth 2.0 authentication with access tokens for secure API requests and data access.",
      entities: ["REST API", "OAuth 2.0"],
      tier: "official_docs",
      section: "Authentication",
    });

    const bad: EvidenceItem = item({
      claim: "Click here to learn more.",
      entities: [],
      tier: "media",
    });

    const result = filterEvidence([good, bad]);

    expect(result.kept).toHaveLength(1);
    expect(result.qualityRejected).toHaveLength(1);
    expect(result.duplicateRejected).toHaveLength(0);
    expect(result.kept[0].claim).toBe(good.claim);
  });

  it("rejects near-duplicate claims keeping the higher-scored one", () => {
    const first: EvidenceItem = item({
      claim:
        "The API uses OAuth 2.0 access tokens for authentication of API requests and user authorization flows.",
      url: "https://docs.example.com/v1",
      entities: ["OAuth 2.0", "API"],
    });

    const second: EvidenceItem = item({
      claim:
        "This API uses OAuth 2.0 access tokens for authentication of API requests and user authorization flows.",
      url: "https://docs.example.com/v2",
      entities: ["OAuth 2.0", "API"],
    });

    const result = filterEvidence([first, second]);

    expect(result.kept).toHaveLength(1);
    expect(result.duplicateRejected).toHaveLength(1);
    expect(result.qualityRejected).toHaveLength(0);
  });

  it("annotates kept evidence with metadata.evidenceQuality", () => {
    const good: EvidenceItem = item({
      claim:
        "Example API supports OAuth 2.0 authentication with scoped access tokens for different permission levels.",
      entities: ["Example API", "OAuth 2.0"],
    });

    const result = filterEvidence([good]);

    expect(result.kept[0].metadata?.evidenceQuality).toBeDefined();
    const eq = result.kept[0].metadata!.evidenceQuality as Record<string, unknown>;
    expect(eq.total).toBeGreaterThanOrEqual(40);
    expect(eq.specificity).toBeGreaterThanOrEqual(0);
    expect(eq.flags).toEqual([]);
  });

  it("removes claims with empty entities array", () => {
    const noEntities: EvidenceItem = item({
      claim:
        "The system provides various configuration options for developers to customize their implementation according to specific needs.",
      entities: [],
      tier: "community",
    });

    const result = filterEvidence([noEntities]);

    expect(result.kept).toHaveLength(0);
    expect(result.qualityRejected).toHaveLength(1);
  });

  it("keeps distinct claims from different sources", () => {
    const a: EvidenceItem = item({
      claim:
        "Meta API requires OAuth access tokens for authenticated requests to their graph endpoints.",
      url: "https://meta.example.com/docs",
      entities: ["Meta API", "OAuth"],
    });

    const b: EvidenceItem = item({
      claim:
        "Google API uses OAuth credentials for authenticated requests on their cloud platform.",
      url: "https://google.example.com/docs",
      entities: ["Google API", "OAuth"],
    });

    const result = filterEvidence([a, b]);

    expect(result.kept).toHaveLength(2);
    expect(result.qualityRejected).toHaveLength(0);
    expect(result.duplicateRejected).toHaveLength(0);
  });
});
