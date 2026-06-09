import type { EvidenceItem } from "./source-types.js";

export type EvidenceQualityScore = {
  total: number;
  specificity: number;
  authority: number;
  sectionQuality: number;
  domainSignal: number;
  entityDensity: number;
  flags: string[];
};

const TECH_TERMS = [
  "api", "sdk", "oauth", "token", "endpoint", "request", "response",
  "authenticate", "authorize", "permission", "scope", "credential",
  "key", "secret", "rate limit", "quota", "pricing", "version",
  "deprecated", "field", "schema", "parameter", "header", "body",
  "json", "xml", "rest", "graphql", "webhook",
];

const TIER_SCORES: Record<string, number> = {
  official_docs: 25,
  trusted_docs: 20,
  reference_examples: 14,
  community: 8,
  media: 6,
  unknown: 10,
};

function scoreSpecificity(claim: string): number {
  let score = 0;

  if (/\d/.test(claim)) score += 8;

  const entities =
    claim.match(
      /\b[A-Z][A-Za-z0-9.]*(?:\s+[A-Z][A-Za-z0-9.]*){0,3}\b/g
    ) ?? [];
  if (entities.length >= 3) score += 10;
  else if (entities.length >= 2) score += 7;
  else if (entities.length >= 1) score += 3;

  const techHits = TECH_TERMS.filter((t) =>
    claim.toLowerCase().includes(t)
  ).length;
  if (techHits >= 3) score += 7;
  else if (techHits >= 2) score += 4;
  else if (techHits >= 1) score += 2;

  if (claim.length >= 140) score += 5;
  else if (claim.length >= 90) score += 3;

  return Math.min(30, score);
}

function scoreAuthority(item: EvidenceItem): number {
  return TIER_SCORES[item.tier] ?? 10;
}

function scoreSectionQuality(section?: string): number {
  if (!section) return 5;
  const h = section.toLowerCase();

  if (
    /\b(api|reference|authentication|authorization|endpoint|request|response|field|schema|parameter|property)\b/.test(
      h
    )
  ) {
    return 15;
  }
  if (
    /\b(example|tutorial|guide|getting started|quickstart|overview|introduction)\b/.test(
      h
    )
  ) {
    return 10;
  }
  if (
    /\b(faq|troubleshooting|common issues|errors|best practices)\b/.test(h)
  ) {
    return 8;
  }
  return 5;
}

function scoreDomainSignal(claim: string): number {
  const matches = TECH_TERMS.filter((t) =>
    claim.toLowerCase().includes(t)
  ).length;
  const density = matches / Math.max(1, claim.split(/\s+/).length);

  if (density >= 0.15) return 20;
  if (density >= 0.08) return 14;
  if (matches >= 3) return 10;
  if (matches >= 2) return 6;
  if (matches >= 1) return 3;
  return 0;
}

function scoreEntityDensity(claim: string, entities: string[]): number {
  const effective = entities.filter((e) => e.length > 2);
  const density = effective.length / Math.max(1, claim.split(/\s+/).length);

  if (density >= 0.12) return 10;
  if (density >= 0.06) return 6;
  if (effective.length >= 2) return 4;
  if (effective.length >= 1) return 2;
  return 0;
}

function detectFlags(claim: string): string[] {
  const flags: string[] = [];
  const normalized = claim.toLowerCase().trim();

  if (
    /^(click|read|learn|see|visit|go to|check out|find out|skip to)/i.test(
      normalized
    )
  ) {
    flags.push("navigation_like");
  }

  if (normalized.length < 60) {
    flags.push("too_short");
  }

  const entities =
    claim.match(
      /\b[A-Z][A-Za-z0-9.]*(?:\s+[A-Z][A-Za-z0-9.]*){0,3}\b/g
    ) ?? [];
  if (entities.length === 0) {
    flags.push("no_entities");
  }

  return flags;
}

export function scoreEvidenceItem(item: EvidenceItem): EvidenceQualityScore {
  const flags = detectFlags(item.claim);
  const specificity = scoreSpecificity(item.claim);
  const authority = scoreAuthority(item);
  const sectionQuality = scoreSectionQuality(item.section);
  const domainSignal = scoreDomainSignal(item.claim);
  const entityDensity = scoreEntityDensity(item.claim, item.entities);

  let total = specificity + authority + sectionQuality + domainSignal + entityDensity;

  if (flags.includes("navigation_like")) {
    total = Math.min(total, 20);
  }

  return {
    total,
    specificity,
    authority,
    sectionQuality,
    domainSignal,
    entityDensity,
    flags,
  };
}

function wordJaccard(a: string, b: string): number {
  const wordsA = new Set(
    a
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2)
  );
  const wordsB = new Set(
    b
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2)
  );

  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }

  const union = wordsA.size + wordsB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function filterEvidence(
  evidence: EvidenceItem[]
): {
  kept: EvidenceItem[];
  qualityRejected: EvidenceItem[];
  duplicateRejected: EvidenceItem[];
} {
  const QUALITY_THRESHOLD = 40;

  const qualityRejected: EvidenceItem[] = [];
  const passed: Array<{ item: EvidenceItem; score: EvidenceQualityScore }> = [];

  for (const item of evidence) {
    const score = scoreEvidenceItem(item);

    if (score.total < QUALITY_THRESHOLD || item.entities.length === 0) {
      qualityRejected.push(item);
      continue;
    }

    passed.push({ item, score });
  }

  passed.sort((a, b) => b.score.total - a.score.total);

  const kept: EvidenceItem[] = [];
  const duplicateRejected: EvidenceItem[] = [];

  for (const entry of passed) {
    let isDuplicate = false;

    for (const existing of kept) {
      const jaccard = wordJaccard(entry.item.claim, existing.claim);
      if (jaccard > 0.7) {
        isDuplicate = true;
        break;
      }
    }

    if (isDuplicate) {
      duplicateRejected.push(entry.item);
    } else {
      entry.item.metadata = {
        ...(entry.item.metadata ?? {}),
        evidenceQuality: {
          total: entry.score.total,
          specificity: entry.score.specificity,
          authority: entry.score.authority,
          sectionQuality: entry.score.sectionQuality,
          domainSignal: entry.score.domainSignal,
          entityDensity: entry.score.entityDensity,
          flags: entry.score.flags,
        },
      };
      kept.push(entry.item);
    }
  }

  return { kept, qualityRejected, duplicateRejected };
}
