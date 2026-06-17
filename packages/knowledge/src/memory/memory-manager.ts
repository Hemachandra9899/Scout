import { Prisma } from "@prisma/client";
import { prisma } from "@rlm-forge/database/prisma.js";
import type {
  ScoutMemory,
  ScoutMemoryDraft,
  ScoutMemorySearchInput,
} from "./memory-types.js";
import type { EvidenceItem, EvidencePack } from "../research/source-types.js";

type CrawlFailureForMemory = {
  title?: string;
  url?: string;
  reason: string;
};

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(String).filter(Boolean);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function unique(values: Array<string | undefined | null>): string[] {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function normalizeForKey(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function memoryDraftKey(draft: ScoutMemoryDraft): string {
  return [
    draft.projectId,
    draft.userId ?? "",
    draft.scope,
    draft.kind,
    normalizeForKey(draft.text),
    unique(draft.sourceUrls ?? []).sort().join("|"),
  ].join("::");
}

function dedupeDrafts(drafts: ScoutMemoryDraft[]): ScoutMemoryDraft[] {
  const seen = new Set<string>();
  const deduped: ScoutMemoryDraft[] = [];

  for (const draft of drafts) {
    const key = memoryDraftKey(draft);
    if (seen.has(key)) continue;

    seen.add(key);
    deduped.push({
      ...draft,
      entities: unique(draft.entities ?? []),
      sourceUrls: unique(draft.sourceUrls ?? []),
    });
  }

  return deduped;
}

function toScoutMemory(row: any): ScoutMemory {
  return {
    id: row.id,
    projectId: row.projectId,
    userId: row.userId,
    scope: row.scope,
    kind: row.kind,
    text: row.text,
    entities: asStringArray(row.entities),
    sourceUrls: asStringArray(row.sourceUrls),
    confidence: row.confidence ?? 0.7,
    eventTime: row.eventTime,
    metadata: asRecord(row.metadata),
    createdAt: row.createdAt,
  };
}

function scoreMemory(query: string, memory: ScoutMemory): number {
  const q = query.toLowerCase();
  const text = memory.text.toLowerCase();

  const entityScore = memory.entities.some((entity) =>
    q.includes(entity.toLowerCase())
  )
    ? 25
    : 0;

  const keywordScore = q
    .split(/\s+/)
    .filter((token) => token.length > 3 && text.includes(token)).length;

  const recencyScore = Math.max(
    0,
    10 -
      Math.floor(
        (Date.now() - memory.createdAt.getTime()) / (1000 * 60 * 60 * 24 * 30)
      )
  );

  const kindBoost =
    memory.kind === "durable_fact"
      ? 12
      : memory.kind === "source_quality"
        ? 8
        : memory.kind === "source_failure"
          ? 6
          : 0;

  return memory.confidence * 50 + entityScore + keywordScore * 3 + recencyScore + kindBoost;
}

function extractDomains(text: string): string[] {
  const domains = text.match(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/gi) ?? [];
  return [...new Set(domains.map((d) => d.toLowerCase()))];
}

function looksLikePreference(text: string): boolean {
  const q = text.toLowerCase();
  return (
    q.includes("i prefer") ||
    q.includes("my preference") ||
    q.includes("for future") ||
    q.includes("please always") ||
    q.includes("i like") ||
    q.includes("i want")
  );
}

function extractTopicEntities(text: string): string[] {
  const products: string[] = text.match(/\b[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)+/g) ?? [];
  const apiMatches: string[] = text.match(/\b[A-Z][a-z]+(?:\s+API)\b/g) ?? [];
  return [...new Set([...products, ...apiMatches])];
}

function looksLikeSourceSave(text: string): boolean {
  const q = text.toLowerCase();
  return (
    (q.includes("save") && q.includes("sourc")) ||
    (q.includes("remember") && q.includes("sourc"))
  );
}

function looksLikeBlockedSource(text: string): boolean {
  const q = text.toLowerCase();
  return (
    q.includes("avoid") ||
    q.includes("block") ||
    q.includes("untrusted") ||
    q.includes("unreliable") ||
    q.includes("do not use") ||
    q.includes("don't use")
  );
}

function tierConfidence(item: EvidenceItem): number {
  if (item.tier === "official_docs" || item.tier === "trusted_docs") return 0.9;
  if (item.tier === "reference_examples") return 0.72;
  if (item.tier === "community") return 0.6;
  return 0.65;
}

function extractRepoFullNameFromUrl(url: string): string | null {
  const match = url.match(/github\.com\/([^/\s]+)\/([^/\s?#]+)/i);
  if (!match) return null;
  return `${match[1]}/${match[2].replace(/\.git$/i, "")}`;
}

export type RepoMemoryInput = {
  projectId: string;
  userId?: string;
  repoUrl: string;
  repoName?: string;
  description?: string | null;
  selectedFiles?: string[];
  stack?: string[];
  answer?: string;
};

export class MemoryManager {
  async addMany(drafts: ScoutMemoryDraft[]): Promise<number> {
    const deduped = dedupeDrafts(drafts);
    if (deduped.length === 0) return 0;

    await prisma.memory.createMany({
      data: deduped.map((draft) => ({
        projectId: draft.projectId,
        userId: draft.userId,
        scope: draft.scope,
        kind: draft.kind,
        text: draft.text,
        entities: (draft.entities ?? []) as unknown as Prisma.InputJsonValue,
        sourceUrls: (draft.sourceUrls ?? []) as unknown as Prisma.InputJsonValue,
        confidence: draft.confidence ?? 0.7,
        eventTime: draft.eventTime,
        metadata: (draft.metadata ?? {}) as unknown as Prisma.InputJsonValue,
      })),
    });

    return deduped.length;
  }

  async search(input: ScoutMemorySearchInput): Promise<ScoutMemory[]> {
    const limit = input.limit ?? 8;

    const userScopeWhere = input.userId
      ? {
          OR: [{ userId: input.userId }, { userId: null }],
        }
      : {
          userId: null,
        };

    const rows = await prisma.memory.findMany({
      where: {
        projectId: input.projectId,
        ...userScopeWhere,
        ...(input.scopes?.length ? { scope: { in: input.scopes } } : {}),
        ...(input.kinds?.length ? { kind: { in: input.kinds } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: Math.max(limit * 5, 25),
    });

    return rows
      .map(toScoutMemory)
      .sort((a, b) => scoreMemory(input.query, b) - scoreMemory(input.query, a))
      .slice(0, limit);
  }

  buildExplicitMemoriesFromUserMessage(input: {
    projectId: string;
    userId?: string;
    message: string;
  }): ScoutMemoryDraft[] {
    const text = input.message.trim();
    if (!text) return [];

    const domains = extractDomains(text);
    const drafts: ScoutMemoryDraft[] = [];

    if (looksLikePreference(text) && !looksLikeBlockedSource(text)) {
      drafts.push({
        projectId: input.projectId,
        userId: input.userId,
        scope: "user",
        kind: "preference",
        text,
        entities: ["preference"],
        confidence: 0.95,
        metadata: {
          source: "explicit_user_message",
        },
      });
    }

    if (looksLikeSourceSave(text)) {
      const topicEntities = extractTopicEntities(text);
      drafts.push({
        projectId: input.projectId,
        userId: input.userId,
        scope: "source",
        kind: "source_quality",
        text: `User wants to save useful official sources: ${text}`,
        sourceUrls: [],
        entities: topicEntities,
        confidence: 0.9,
        metadata: {
          source: "explicit_user_message",
          sourceSaveRequest: true,
        },
      });
    }

    if (looksLikeBlockedSource(text) && domains.length > 0) {
      for (const domain of domains) {
        drafts.push({
          projectId: input.projectId,
          userId: input.userId,
          scope: "source",
          kind: "source_failure",
          text: `User marked ${domain} as blocked or unreliable: ${text}`,
          entities: [domain, "blocked_source"],
          sourceUrls: [`https://${domain}`],
          confidence: 0.98,
          metadata: {
            source: "explicit_user_message",
            domain,
            domain_blocked: true,
            user_blocked: true,
          },
        });
      }
    }

    return dedupeDrafts(drafts);
  }

  buildSourceMemoriesFromEvidencePack(input: {
    projectId: string;
    userId?: string;
    evidencePack: EvidencePack;
  }): ScoutMemoryDraft[] {
    const byUrl = new Map<
      string,
      {
        item: EvidenceItem;
        claimCount: number;
        supportedClaimCount: number;
      }
    >();

    input.evidencePack.evidence.forEach((item, index) => {
      if (!item.url) return;

      const existing = byUrl.get(item.url);
      const verification = input.evidencePack.citationVerification[index];
      const supported = verification?.status === "supported";

      if (!existing) {
        byUrl.set(item.url, {
          item,
          claimCount: 1,
          supportedClaimCount: supported ? 1 : 0,
        });
      } else {
        existing.claimCount += 1;
        if (supported) existing.supportedClaimCount += 1;

        if (tierConfidence(item) > tierConfidence(existing.item)) {
          existing.item = item;
        }
      }
    });

    const drafts: ScoutMemoryDraft[] = [];

    for (const [url, aggregate] of byUrl) {
      const item = aggregate.item;

      drafts.push({
        projectId: input.projectId,
        userId: input.userId,
        scope: "source",
        kind: "source_quality",
        text: `Source "${item.title}" was useful for query "${input.evidencePack.query}" with ${aggregate.claimCount} extracted claims and ${aggregate.supportedClaimCount} supported claims.`,
        sourceUrls: [url],
        entities: [item.product, item.domain, ...item.entities].filter(Boolean) as string[],
        confidence: Math.min(
          0.95,
          tierConfidence(item) + Math.min(aggregate.supportedClaimCount, 5) * 0.01
        ),
        metadata: {
          title: item.title,
          tier: item.tier,
          reason: item.reason,
          query: input.evidencePack.query,
          claimCount: aggregate.claimCount,
          supportedClaimCount: aggregate.supportedClaimCount,
        },
      });
    }

    return drafts;
  }

  buildFailureMemoriesFromCrawlFailures(input: {
    projectId: string;
    userId?: string;
    query: string;
    failedCrawls: CrawlFailureForMemory[];
  }): ScoutMemoryDraft[] {
    return input.failedCrawls
      .filter((failure) => Boolean(failure.url))
      .map((failure) => {
        const reason = failure.reason ?? "";
        const isBlockedDomain =
          reason.includes("403") ||
          reason.toLowerCase().includes("blocked") ||
          reason.toLowerCase().includes("forbidden") ||
          reason.includes("Domain blocked");

        return {
          projectId: input.projectId,
          userId: input.userId,
          scope: "source",
          kind: "source_failure",
          text: `Source "${failure.url}" failed during crawl for query "${input.query}" because: ${failure.reason}`,
          sourceUrls: [failure.url as string],
          confidence: isBlockedDomain ? 0.9 : 0.8,
          metadata: {
            title: failure.title,
            query: input.query,
            reason: failure.reason,
            ...(isBlockedDomain ? { domain_blocked: true } : {}),
          },
        };
      });
  }

  buildDurableFactMemoriesFromEvidencePack(input: {
    projectId: string;
    userId?: string;
    evidencePack: EvidencePack;
  }): ScoutMemoryDraft[] {
    const drafts: ScoutMemoryDraft[] = [];

    input.evidencePack.evidence.forEach((item, index) => {
      const verification = input.evidencePack.citationVerification[index];
      if (verification?.status !== "supported") return;

      const sourceUrls =
        verification.supportingUrls.length > 0
          ? verification.supportingUrls
          : [item.url];

      drafts.push({
        projectId: input.projectId,
        userId: input.userId,
        scope: "project",
        kind: "durable_fact",
        text: item.claim,
        sourceUrls,
        entities: item.entities,
        confidence: item.confidence,
        metadata: {
          title: item.title,
          section: item.section,
          tier: item.tier,
          quote: item.quote,
          query: input.evidencePack.query,
          reason: verification.reason,
        },
      });
    });

    return dedupeDrafts(drafts);
  }

  buildRepoMemories(input: RepoMemoryInput): ScoutMemoryDraft[] {
    const repoName = input.repoName ?? extractRepoFullNameFromUrl(input.repoUrl);
    if (!repoName) return [];

    const selectedFiles = input.selectedFiles ?? [];
    const stack = input.stack ?? [];
    const answer = input.answer ?? "";

    const drafts: ScoutMemoryDraft[] = [
      {
        projectId: input.projectId,
        userId: input.userId,
        scope: "source",
        kind: "source_quality",
        text: `GitHub repository ${repoName} was analyzed and saved as useful repo context.`,
        sourceUrls: [input.repoUrl],
        entities: [repoName, "github_repo", "repo_memory", ...stack],
        confidence: 0.95,
        metadata: {
          source: "memo_repo",
          repoName,
          repoUrl: input.repoUrl,
          stack,
          selectedFiles,
        },
      },
      {
        projectId: input.projectId,
        userId: input.userId,
        scope: "project",
        kind: "durable_fact",
        text: `Repository ${repoName} contains these detected components: ${stack.length ? stack.join(", ") : "unknown stack"}.`,
        sourceUrls: [input.repoUrl],
        entities: [repoName, ...stack],
        confidence: 0.85,
        metadata: {
          source: "memo_repo",
          repoName,
          repoUrl: input.repoUrl,
          factType: "repo_stack",
        },
      },
    ];

    if (selectedFiles.length > 0) {
      drafts.push({
        projectId: input.projectId,
        userId: input.userId,
        scope: "project",
        kind: "durable_fact",
        text: `Repository ${repoName} important files include: ${selectedFiles.slice(0, 20).join(", ")}.`,
        sourceUrls: [input.repoUrl],
        entities: [repoName, "important_files"],
        confidence: 0.85,
        metadata: {
          source: "memo_repo",
          repoName,
          repoUrl: input.repoUrl,
          selectedFiles: selectedFiles.slice(0, 50),
          factType: "repo_files",
        },
      });
    }

    if (answer.trim()) {
      drafts.push({
        projectId: input.projectId,
        userId: input.userId,
        scope: "project",
        kind: "durable_fact",
        text: answer.slice(0, 3000),
        sourceUrls: [input.repoUrl],
        entities: [repoName, "repo_summary"],
        confidence: 0.8,
        metadata: {
          source: "memo_repo",
          repoName,
          repoUrl: input.repoUrl,
          factType: "repo_summary",
        },
      });
    }

    return dedupeDrafts(drafts);
  }
}
