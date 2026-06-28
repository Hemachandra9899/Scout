import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@rlm-forge/database/prisma.js";
import type { ScoutMemoryDraft, ScoutMemoryKind, ScoutMemoryScope } from "./memory-types.js";

export type ScoutMemoryTier =
  | "working"
  | "episodic"
  | "semantic"
  | "procedural";

export type CuratedMemoryDraft = ScoutMemoryDraft & {
  tier: ScoutMemoryTier;
  contentHash: string;
  normalizedText: string;
  curatorReason: string;
};

export type MemoryCuratorDecision =
  | {
      action: "write";
      draft: CuratedMemoryDraft;
      reason: string;
    }
  | {
      action: "skip";
      draft: ScoutMemoryDraft;
      reason: string;
    };

export type MemoryCuratorResult = {
  proposedCount: number;
  writtenCount: number;
  skippedCount: number;
  decisions: MemoryCuratorDecision[];
  debug: {
    curatorUsed: true;
    proposedCount: number;
    writtenCount: number;
    skippedCount: number;
    writtenHashes: string[];
    skippedReasons: string[];
  };
};

function normalizeMemoryText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'");
}

function hashMemory(input: {
  projectId: string;
  userId?: string | null;
  scope: ScoutMemoryScope;
  kind: ScoutMemoryKind;
  text: string;
  sourceUrls?: string[];
}) {
  const normalizedText = normalizeMemoryText(input.text);
  const sourceKey = [...(input.sourceUrls ?? [])].sort().join("|");

  const raw = [
    input.projectId,
    input.userId ?? "",
    input.scope,
    input.kind,
    normalizedText,
    sourceKey,
  ].join("::");

  return createHash("sha256").update(raw).digest("hex");
}

function inferTier(draft: ScoutMemoryDraft): ScoutMemoryTier {
  if (draft.kind === "preference") return "semantic";
  if (draft.kind === "durable_fact") return "semantic";
  if (draft.kind === "source_quality") return "procedural";
  if (draft.kind === "source_failure") return "procedural";
  if (draft.kind === "decision") return "episodic";
  if (draft.kind === "task_trace") return "episodic";
  return "episodic";
}

function hasSourceUrls(draft: ScoutMemoryDraft): boolean {
  return Array.isArray(draft.sourceUrls) && draft.sourceUrls.length > 0;
}

function shouldSkipDraft(draft: ScoutMemoryDraft): string | null {
  const text = draft.text?.trim() ?? "";

  if (text.length < 8) {
    return "Memory text too short.";
  }

  if (text.length > 2000) {
    return "Memory text too long.";
  }

  if (draft.kind === "durable_fact" && !hasSourceUrls(draft)) {
    return "Durable facts require sourceUrls/provenance.";
  }

  if (draft.confidence !== undefined && draft.confidence < 0.45) {
    return "Memory confidence below write threshold.";
  }

  return null;
}

async function existingMemoryHashes(input: {
  projectId: string;
  userId?: string | null;
  hashes: string[];
}) {
  if (input.hashes.length === 0) return new Set<string>();

  const rows = await prisma.memory.findMany({
    where: {
      projectId: input.projectId,
    },
    select: {
      metadata: true,
    },
    take: 5000,
  });

  const found = new Set<string>();

  for (const row of rows) {
    const metadata = row.metadata as Record<string, unknown> | null;
    const hash =
      (metadata as any)?.contentHash ?? (metadata as any)?.memoryHash;

    if (typeof hash === "string") {
      found.add(hash);
    }
  }

  return found;
}

export async function curateAndWriteMemories(input: {
  projectId: string;
  userId?: string;
  drafts: ScoutMemoryDraft[];
  dryRun?: boolean;
}): Promise<MemoryCuratorResult> {
  const prepared = input.drafts.map((draft) => {
    const normalizedText = normalizeMemoryText(draft.text);
    const contentHash = hashMemory({
      projectId: input.projectId,
      userId: input.userId,
      scope: draft.scope,
      kind: draft.kind,
      text: draft.text,
      sourceUrls: draft.sourceUrls,
    });

    return {
      draft,
      normalizedText,
      contentHash,
      tier: inferTier(draft),
    };
  });

  const existing = await existingMemoryHashes({
    projectId: input.projectId,
    userId: input.userId,
    hashes: prepared.map((item) => item.contentHash),
  });

  const seenThisBatch = new Set<string>();
  const decisions: MemoryCuratorDecision[] = [];

  for (const item of prepared) {
    const skipReason = shouldSkipDraft(item.draft);

    if (skipReason) {
      decisions.push({
        action: "skip",
        draft: item.draft,
        reason: skipReason,
      });
      continue;
    }

    if (existing.has(item.contentHash)) {
      decisions.push({
        action: "skip",
        draft: item.draft,
        reason: "Duplicate memory already exists in DB.",
      });
      continue;
    }

    if (seenThisBatch.has(item.contentHash)) {
      decisions.push({
        action: "skip",
        draft: item.draft,
        reason: "Duplicate memory proposed in same batch.",
      });
      continue;
    }

    seenThisBatch.add(item.contentHash);

    decisions.push({
      action: "write",
      draft: {
        ...item.draft,
        tier: item.tier,
        contentHash: item.contentHash,
        normalizedText: item.normalizedText,
        curatorReason: "Passed curator write gates.",
      },
      reason: "Passed curator write gates.",
    });
  }

  const writeDecisions = decisions.filter(
    (decision): decision is Extract<MemoryCuratorDecision, { action: "write" }> =>
      decision.action === "write",
  );

  if (!input.dryRun && writeDecisions.length > 0) {
    await prisma.memory.createMany({
      data: writeDecisions.map(({ draft }) => ({
        projectId: input.projectId,
        userId: input.userId,
        scope: draft.scope,
        kind: draft.kind,
        text: draft.text,
        entities: (draft.entities ?? []) as unknown as Prisma.InputJsonValue,
        sourceUrls: (draft.sourceUrls ?? []) as unknown as Prisma.InputJsonValue,
        confidence: draft.confidence ?? 0.7,
        eventTime: draft.eventTime,
        metadata: {
          ...(draft.metadata ?? {}),
          tier: draft.tier,
          contentHash: draft.contentHash,
          memoryHash: draft.contentHash,
          normalizedText: draft.normalizedText,
          curatorReason: draft.curatorReason,
          curatorVersion: "m4.1",
        } as unknown as Prisma.InputJsonValue,
      })),
      skipDuplicates: true,
    });
  }

  const skippedReasons = decisions
    .filter((decision) => decision.action === "skip")
    .map((decision) => decision.reason);

  const writtenHashes = writeDecisions.map((decision) => decision.draft.contentHash);

  return {
    proposedCount: input.drafts.length,
    writtenCount: writeDecisions.length,
    skippedCount: decisions.length - writeDecisions.length,
    decisions,
    debug: {
      curatorUsed: true,
      proposedCount: input.drafts.length,
      writtenCount: writeDecisions.length,
      skippedCount: decisions.length - writeDecisions.length,
      writtenHashes,
      skippedReasons,
    },
  };
}
