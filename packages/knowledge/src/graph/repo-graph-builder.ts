import crypto from "node:crypto";
import { prisma } from "@rlm-forge/database/prisma.js";

export type RepoFile = {
  path: string;
  text: string;
};

export type RepoGraphBuildMode = "full" | "incremental";

export type BuildRepoGraphInput = {
  projectId: string;
  repoName: string;
  repoUrl?: string;
  stack?: string[];
  selectedFiles?: string[];
  files: RepoFile[];
  mode?: RepoGraphBuildMode;
};

export type BuildRepoGraphOutput = {
  entityCount: number;
  relationCount: number;
  graphUpdateMode: RepoGraphBuildMode;
  changedFileCount: number;
  skippedFileCount: number;
  deletedEntityCount: number;
  deletedRelationCount: number;
};

function hashText(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function getMetadataValue(metadata: unknown, key: string): unknown {
  if (!metadata || typeof metadata !== "object") return undefined;
  return (metadata as Record<string, unknown>)[key];
}

async function getExistingFileHash(input: {
  projectId: string;
  repoName: string;
  filePath: string;
}): Promise<string | null> {
  const existing = await prisma.entity.findFirst({
    where: {
      projectId: input.projectId,
      type: "file",
      name: input.filePath,
    },
  });

  const metadata = existing?.metadata ?? {};
  const repoName = getMetadataValue(metadata, "repoName");
  const contentHash = getMetadataValue(metadata, "contentHash");

  if (repoName !== input.repoName) return null;
  return typeof contentHash === "string" ? contentHash : null;
}

async function detectChangedFiles(input: {
  projectId: string;
  repoName: string;
  files: RepoFile[];
  mode: RepoGraphBuildMode;
}): Promise<{
  changedFiles: RepoFile[];
  skippedFiles: RepoFile[];
}> {
  if (input.mode === "full") {
    return { changedFiles: input.files, skippedFiles: [] };
  }

  const changedFiles: RepoFile[] = [];
  const skippedFiles: RepoFile[] = [];

  for (const file of input.files) {
    const currentHash = hashText(file.text);
    const existingHash = await getExistingFileHash({
      projectId: input.projectId,
      repoName: input.repoName,
      filePath: file.path,
    });

    if (existingHash && existingHash === currentHash) {
      skippedFiles.push(file);
    } else {
      changedFiles.push(file);
    }
  }

  return { changedFiles, skippedFiles };
}

async function deleteFileSubgraphs(input: {
  projectId: string;
  filePaths: string[];
}): Promise<{
  deletedEntityCount: number;
  deletedRelationCount: number;
}> {
  if (input.filePaths.length === 0) {
    return { deletedEntityCount: 0, deletedRelationCount: 0 };
  }

  const fileEntities = await prisma.entity.findMany({
    where: {
      projectId: input.projectId,
      type: "file",
      name: { in: input.filePaths },
    },
  });

  const entityIds = fileEntities.map((e) => e.id);

  if (entityIds.length === 0) {
    return { deletedEntityCount: 0, deletedRelationCount: 0 };
  }

  await prisma.relation.deleteMany({
    where: {
      projectId: input.projectId,
      OR: [
        { sourceEntityId: { in: entityIds } },
        { targetEntityId: { in: entityIds } },
      ],
    },
  });

  await prisma.entity.deleteMany({
    where: {
      projectId: input.projectId,
      id: { in: entityIds },
    },
  });

  const deletedEntityCount = entityIds.length;

  return { deletedEntityCount, deletedRelationCount: 0 };
}

const SYMBOL_PATTERNS: Array<{ lang: string; pattern: RegExp; type: string }> = [
  { lang: "ts", pattern: /export\s+(class|function|const|interface|type|enum)\s+(\w+)/g, type: "symbol" },
  { lang: "ts", pattern: /(?:^|\n)\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)/g, type: "symbol" },
  { lang: "ts", pattern: /(?:^|\n)\s*(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/g, type: "symbol" },
  { lang: "ts", pattern: /(?:^|\n)\s*(?:export\s+)?interface\s+(\w+)/g, type: "symbol" },
  { lang: "ts", pattern: /(?:^|\n)\s*(?:export\s+)?type\s+(\w+)\s*=/g, type: "symbol" },
  { lang: "ts", pattern: /(?:^|\n)\s*(?:export\s+)?const\s+(\w+)\s*[:=]/g, type: "symbol" },
  { lang: "py", pattern: /(?:^|\n)\s*(?:async\s+)?def\s+(\w+)/g, type: "symbol" },
  { lang: "py", pattern: /(?:^|\n)\s*class\s+(\w+)/g, type: "symbol" },
];

const IMPORT_PATTERNS: Array<{ lang: string; pattern: RegExp }> = [
  { lang: "ts", pattern: /import\s+(?:(?:\{[^}]*\}|\w+(?:\s*,\s*\w+)*)\s+from\s+)?['"]([^'"]+)['"]/g },
  { lang: "ts", pattern: /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g },
  { lang: "py", pattern: /^import\s+(\S+)/gm },
  { lang: "py", pattern: /^from\s+(\S+)\s+import/gm },
];

function detectLang(path: string): string {
  if (/\.(ts|tsx)$/.test(path)) return "ts";
  if (/\.(js|jsx|mjs)$/.test(path)) return "ts";
  if (/\.py$/.test(path)) return "py";
  return "unknown";
}

function extractSymbols(text: string, lang: string): Array<{ name: string; type: string }> {
  const symbols: Array<{ name: string; type: string }> = [];
  for (const pat of SYMBOL_PATTERNS) {
    if (pat.lang !== lang) continue;
    const matches = text.matchAll(pat.pattern);
    for (const m of matches) {
      const name = m[2] ?? m[1];
      if (name && !name.startsWith("_")) {
        symbols.push({ name, type: m[1] === "class" ? "class" : "function" });
      }
    }
  }
  return symbols;
}

function extractImports(text: string, lang: string): string[] {
  const imports: string[] = [];
  for (const pat of IMPORT_PATTERNS) {
    if (pat.lang !== lang) continue;
    const matches = text.matchAll(pat.pattern);
    for (const m of matches) {
      const importPath = m[1];
      if (importPath) imports.push(importPath);
    }
  }
  return imports;
}

function isExternalDep(importPath: string): boolean {
  return !importPath.startsWith(".") && !importPath.startsWith("/");
}

export async function buildAndPersistRepoGraph(input: BuildRepoGraphInput): Promise<BuildRepoGraphOutput> {
  const { projectId, repoName, files } = input;
  const mode = input.mode ?? "full";

  const { changedFiles, skippedFiles } = await detectChangedFiles({
    projectId,
    repoName,
    files,
    mode,
  });

  const changedFilePaths = changedFiles.map((f) => f.path);

  const { deletedEntityCount, deletedRelationCount } = await deleteFileSubgraphs({
    projectId,
    filePaths: changedFilePaths,
  });

  const existingEntities = await prisma.entity.findMany({ where: { projectId }, select: { id: true, name: true, type: true, metadata: true } });
  const existingEntityMap = new Map<string, string>();
  for (const e of existingEntities) {
    existingEntityMap.set(`${e.name}:${e.type}`, e.id);
  }

  const existingRelations = await prisma.relation.findMany({
    where: { projectId },
    select: { id: true, sourceEntityId: true, targetEntityId: true, relationType: true },
  });
  const existingRelSet = new Set<string>();
  for (const r of existingRelations) {
    existingRelSet.add(`${r.sourceEntityId}:${r.targetEntityId}:${r.relationType}`);
  }

  const entitiesToCreate: any[] = [];
  const relationsToCreate: any[] = [];
  const createdEntityKeys = new Map<string, string>();

  function getOrCreateEntityKey(name: string, type: string, description: string, confidence: number, metadata: any): string {
    const key = `${name}:${type}`;
    const existing = existingEntityMap.get(key);
    if (existing) return existing;
    const created = createdEntityKeys.get(key);
    if (created) return created;
    const placeholder = `__pending_${key}`;
    entitiesToCreate.push({ projectId, name, type, description, confidence, metadata });
    createdEntityKeys.set(key, placeholder);
    return placeholder;
  }

  for (const file of changedFiles) {
    const lang = detectLang(file.path);
    if (lang === "unknown") continue;

    const fileName = file.path.split("/").pop() ?? file.path;
    const contentHash = hashText(file.text);
    const fileEntityKey = getOrCreateEntityKey(
      fileName,
      "file",
      `File: ${file.path}`,
      1.0,
      { path: file.path, contentHash, repoName },
    );

    const symbols = extractSymbols(file.text, lang);
    for (const sym of symbols) {
      const symKey = getOrCreateEntityKey(sym.name, sym.type, `${sym.type} defined in ${file.path}`, 0.9, { sourceFile: file.path, lang });
      const relKey = `${fileEntityKey}:${symKey}:contains`;
      if (!existingRelSet.has(relKey)) {
        relationsToCreate.push({
          projectId, sourceEntityId: fileEntityKey, targetEntityId: symKey,
          relationType: "contains", confidence: 1.0, metadata: { lang },
        });
      }
    }

    const imports = extractImports(file.text, lang);
    for (const importPath of imports) {
      if (isExternalDep(importPath)) continue;
      const moduleName = importPath.split("/").filter(Boolean).join("/");
      const modKey = getOrCreateEntityKey(moduleName, "module", `Module imported by ${file.path}`, 0.7, { referencedBy: [file.path] });
      const relKey = `${fileEntityKey}:${modKey}:imports`;
      if (!existingRelSet.has(relKey)) {
        relationsToCreate.push({
          projectId, sourceEntityId: fileEntityKey, targetEntityId: modKey,
          relationType: "imports", confidence: 0.8, metadata: { importPath },
        });
      }
    }

    if (file.path === "package.json" || file.path.endsWith("/package.json")) {
      try {
        const pkg = JSON.parse(file.text);
        const allDeps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
        for (const depName of Object.keys(allDeps)) {
          const depEntityKey = getOrCreateEntityKey(depName, "dependency", "External dependency", 0.9, { version: allDeps[depName] });
          const relKey = `${fileEntityKey}:${depEntityKey}:depends_on`;
          if (!existingRelSet.has(relKey)) {
            relationsToCreate.push({
              projectId, sourceEntityId: fileEntityKey, targetEntityId: depEntityKey,
              relationType: "depends_on", confidence: 1.0, metadata: {},
            });
          }
        }
      } catch {
        // failed to parse package.json
      }
    }
  }

  if (entitiesToCreate.length > 0) {
    await prisma.entity.createMany({ data: entitiesToCreate, skipDuplicates: true });
  }

  const allEntities = await prisma.entity.findMany({ where: { projectId }, select: { id: true, name: true, type: true } });
  const entityIdByName = new Map<string, string>();
  for (const e of allEntities) {
    entityIdByName.set(`${e.name}:${e.type}`, e.id);
  }

  const resolvedRelations: any[] = [];
  for (const rel of relationsToCreate) {
    const srcKey = rel.sourceEntityId.replace(/^__pending_/, "");
    const tgtKey = rel.targetEntityId.replace(/^__pending_/, "");
    const srcId = entityIdByName.get(srcKey);
    const tgtId = entityIdByName.get(tgtKey);
    if (srcId && tgtId) {
      const relKey = `${srcId}:${tgtId}:${rel.relationType}`;
      if (!existingRelSet.has(relKey)) {
        resolvedRelations.push({
          projectId: rel.projectId,
          sourceEntityId: srcId,
          targetEntityId: tgtId,
          relationType: rel.relationType,
          confidence: rel.confidence,
          metadata: rel.metadata,
        });
      }
    }
  }

  if (resolvedRelations.length > 0) {
    await prisma.relation.createMany({ data: resolvedRelations, skipDuplicates: true });
  }

  const entityCount = await prisma.entity.count({ where: { projectId } });
  const relationCount = await prisma.relation.count({ where: { projectId } });

  return {
    entityCount,
    relationCount,
    graphUpdateMode: mode,
    changedFileCount: changedFiles.length,
    skippedFileCount: skippedFiles.length,
    deletedEntityCount,
    deletedRelationCount,
  };
}
