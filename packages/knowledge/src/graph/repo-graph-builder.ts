import { prisma } from "@rlm-forge/database/prisma.js";

export type RepoFile = {
  path: string;
  text: string;
};

export type BuildRepoGraphInput = {
  projectId: string;
  repoName: string;
  files: RepoFile[];
};

export type BuildRepoGraphOutput = {
  nodeCount: number;
  edgeCount: number;
  symbolsFound: number;
  importsFound: number;
  depsFound: number;
  errors: string[];
};

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
  const { projectId, files } = input;
  const errors: string[] = [];

  const existingEntities = await prisma.entity.findMany({ where: { projectId }, select: { id: true, name: true, type: true } });
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

  for (const file of files) {
    const lang = detectLang(file.path);
    if (lang === "unknown") continue;

    const fileName = file.path.split("/").pop() ?? file.path;
    const fileEntityKey = getOrCreateEntityKey(fileName, "file", `File: ${file.path}`, 1.0, { path: file.path });

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
        errors.push(`Failed to parse package.json at ${file.path}`);
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
    nodeCount: entityCount,
    edgeCount: relationCount,
    symbolsFound: entitiesToCreate.filter((e: any) => e.type !== "file" && e.type !== "module" && e.type !== "dependency").length,
    importsFound: resolvedRelations.filter((r: any) => r.relationType === "imports").length,
    depsFound: resolvedRelations.filter((r: any) => r.relationType === "depends_on").length,
    errors,
  };
}
