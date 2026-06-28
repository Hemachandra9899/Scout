import { prisma } from "@rlm-forge/database/prisma.js";

type Entity = {
  id: string;
  name: string;
  type: string;
  description: string | null;
  confidence: number | null;
  metadata: unknown;
};

type Relation = {
  id: string;
  sourceEntityId: string;
  targetEntityId: string;
  relationType: string;
  confidence: number | null;
  metadata: unknown;
};

export type RepoGraphReportOutput = {
  status: "ok";
  reportId?: string;
  downloadFilename: string;
  markdown: string;
  entities: Entity[];
  relations: Relation[];
  highDegreeNodes: Array<{
    entity: Entity;
    degree: number;
  }>;
  relationTypeCounts: Record<string, number>;
  suggestedQuestions: string[];
  debug: {
    graphReportUsed: boolean;
    graphReportNodeCount: number;
    graphReportRelationCount: number;
    graphReportHighDegreeCount: number;
    graphReportPersisted: boolean;
    graphReportPersistError?: string;
  };
};

function metadataValue(metadata: unknown, key: string): unknown {
  if (!metadata || typeof metadata !== "object") return undefined;
  return (metadata as Record<string, unknown>)[key];
}

function groupByType(entities: Entity[]): Record<string, Entity[]> {
  const grouped: Record<string, Entity[]> = {};

  for (const entity of entities) {
    grouped[entity.type] ??= [];
    grouped[entity.type].push(entity);
  }

  return grouped;
}

function countRelationTypes(relations: Relation[]): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const relation of relations) {
    counts[relation.relationType] = (counts[relation.relationType] ?? 0) + 1;
  }

  return Object.fromEntries(
    Object.entries(counts).sort((a, b) => b[1] - a[1]),
  );
}

function computeHighDegreeNodes(input: {
  entities: Entity[];
  relations: Relation[];
}): Array<{ entity: Entity; degree: number }> {
  const degree = new Map<string, number>();

  for (const relation of input.relations) {
    degree.set(relation.sourceEntityId, (degree.get(relation.sourceEntityId) ?? 0) + 1);
    degree.set(relation.targetEntityId, (degree.get(relation.targetEntityId) ?? 0) + 1);
  }

  const byId = new Map(input.entities.map((entity) => [entity.id, entity]));

  return [...degree.entries()]
    .map(([id, d]) => ({
      entity: byId.get(id),
      degree: d,
    }))
    .filter((item): item is { entity: Entity; degree: number } => Boolean(item.entity))
    .sort((a, b) => b.degree - a.degree)
    .slice(0, 15);
}

function pickImportantFiles(input: {
  entities: Entity[];
  relations: Relation[];
}): Entity[] {
  const highDegree = computeHighDegreeNodes(input);
  const highDegreeFileIds = new Set(
    highDegree
      .filter((item) => item.entity.type === "file")
      .map((item) => item.entity.id),
  );

  const files = input.entities.filter((entity) => entity.type === "file");

  const scored = [
    ...files.filter((file) => highDegreeFileIds.has(file.id)),
    ...files.filter((file) =>
      /router|service|manager|orchestrator|builder|query|schema|worker|runtime/i.test(file.name),
    ),
  ];

  return scored
    .filter((file, index, arr) => arr.findIndex((x) => x.id === file.id) === index)
    .slice(0, 20);
}

function renderRelationSample(input: {
  entities: Entity[];
  relations: Relation[];
}): string[] {
  const byId = new Map(input.entities.map((entity) => [entity.id, entity]));

  const importantTypes = new Set([
    "contains",
    "imports",
    "depends_on",
  ]);

  return input.relations
    .filter((relation) => importantTypes.has(relation.relationType))
    .slice(0, 20)
    .map((relation) => {
      const source = byId.get(relation.sourceEntityId)?.name ?? relation.sourceEntityId;
      const target = byId.get(relation.targetEntityId)?.name ?? relation.targetEntityId;
      return `- \`${source}\` --${relation.relationType}--> \`${target}\``;
    });
}

function buildSuggestedQuestions(input: {
  services: Entity[];
  importantFiles: Entity[];
  highDegreeNodes: Array<{ entity: Entity; degree: number }>;
}): string[] {
  const questions = [
    "Which files connect the router to memory?",
    "How does the worker connect to the RLM runtime and tools?",
    "Which files are most central in the repo graph?",
    "Which services own the most important files?",
    "What are the main import paths through the codebase?",
  ];

  const topService = input.services[0]?.name;
  if (topService) {
    questions.push(`What are the most important files inside ${topService}?`);
  }

  const topFile = input.importantFiles[0]?.name;
  if (topFile) {
    questions.push(`Which symbols and imports are connected to ${topFile}?`);
  }

  return questions.slice(0, 8);
}

export async function generateRepoGraphReport(input: {
  projectId: string;
  repoName?: string;
  persist?: boolean;
}): Promise<RepoGraphReportOutput> {
  const entities = await prisma.entity.findMany({
    where: {
      projectId: input.projectId,
      ...(input.repoName
        ? {
            OR: [
              { name: { contains: input.repoName, mode: "insensitive" } },
              {
                description: {
                  contains: input.repoName,
                  mode: "insensitive",
                },
              },
            ],
          }
        : {}),
    },
    take: 500,
  });

  const entityIds = entities.map((entity) => entity.id);

  const relations = entityIds.length
    ? await prisma.relation.findMany({
        where: {
          projectId: input.projectId,
          OR: [
            { sourceEntityId: { in: entityIds } },
            { targetEntityId: { in: entityIds } },
          ],
        },
        take: 1000,
      })
    : [];

  const grouped = groupByType(entities);
  const services = [
    ...(grouped.service ?? []),
    ...(grouped.package ?? []),
  ].slice(0, 20);

  const relationTypeCounts = countRelationTypes(relations);
  const highDegreeNodes = computeHighDegreeNodes({ entities, relations });
  const importantFiles = pickImportantFiles({ entities, relations });
  const relationSamples = renderRelationSample({ entities, relations });
  const suggestedQuestions = buildSuggestedQuestions({
    services,
    importantFiles,
    highDegreeNodes,
  });

  const repoEntities = grouped.repo ?? [];
  const repoName =
    input.repoName ??
    repoEntities[0]?.name ??
    String(metadataValue(entities[0]?.metadata, "repoName") ?? "repo graph");

  const lines: string[] = [];

  lines.push("# GRAPH_REPORT.md");
  lines.push("");
  lines.push(`## Repo Graph Report: ${repoName}`);
  lines.push("");
  lines.push("### Overview");
  lines.push("");
  lines.push(`- Graph entities: **${entities.length}**`);
  lines.push(`- Graph relations: **${relations.length}**`);
  lines.push(`- Services/packages: **${services.length}**`);
  lines.push(`- Important files: **${importantFiles.length}**`);
  lines.push("");

  lines.push("### Key services and packages");
  lines.push("");
  if (services.length === 0) {
    lines.push("- No service/package entities found.");
  } else {
    for (const service of services.slice(0, 15)) {
      lines.push(`- \`${service.name}\` — ${service.description ?? service.type}`);
    }
  }
  lines.push("");

  lines.push("### Important files");
  lines.push("");
  if (importantFiles.length === 0) {
    lines.push("- No important file entities found.");
  } else {
    for (const file of importantFiles.slice(0, 20)) {
      lines.push(`- \`${file.name}\``);
    }
  }
  lines.push("");

  lines.push("### High-degree nodes");
  lines.push("");
  if (highDegreeNodes.length === 0) {
    lines.push("- No high-degree nodes found.");
  } else {
    for (const item of highDegreeNodes.slice(0, 15)) {
      lines.push(`- \`${item.entity.name}\` (${item.entity.type}) — degree ${item.degree}`);
    }
  }
  lines.push("");

  lines.push("### Relation type counts");
  lines.push("");
  if (Object.keys(relationTypeCounts).length === 0) {
    lines.push("- No relations found.");
  } else {
    for (const [type, count] of Object.entries(relationTypeCounts)) {
      lines.push(`- \`${type}\`: ${count}`);
    }
  }
  lines.push("");

  lines.push("### Architecture paths");
  lines.push("");
  if (relationSamples.length === 0) {
    lines.push("- No architecture paths found.");
  } else {
    lines.push(...relationSamples);
  }
  lines.push("");

  lines.push("### Suggested follow-up questions");
  lines.push("");
  for (const question of suggestedQuestions) {
    lines.push(`- ${question}`);
  }
  lines.push("");

  const markdown = lines.join("\n");

  let reportId: string | undefined;

  let persistError: string | undefined;

  if (input.persist) {
    try {
      const report = await prisma.report.create({
        data: {
          projectId: input.projectId,
          title: `Repo Graph Report: ${repoName}`,
          content: markdown,
          metadata: {
            source: "repo_graph_report",
            repoName,
            entityCount: entities.length,
            relationCount: relations.length,
            highDegreeCount: highDegreeNodes.length,
            suggestedQuestions,
            relationTypeCounts,
          },
        },
      });

      reportId = report.id;
    } catch (error) {
      persistError = error instanceof Error ? error.message : String(error);
    }
  }

  return {
    status: "ok",
    reportId,
    downloadFilename: "GRAPH_REPORT.md",
    markdown,
    entities,
    relations,
    highDegreeNodes,
    relationTypeCounts,
    suggestedQuestions,
    debug: {
      graphReportUsed: true,
      graphReportNodeCount: entities.length,
      graphReportRelationCount: relations.length,
      graphReportHighDegreeCount: highDegreeNodes.length,
      graphReportPersisted: Boolean(reportId),
      graphReportPersistError: persistError,
    },
  };
}
