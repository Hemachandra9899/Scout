import { prisma } from "@rlm-forge/database/prisma.js";

type GraphEntity = {
  id: string;
  projectId: string;
  name: string;
  type: string;
  description: string | null;
  confidence: number | null;
  metadata: unknown;
  createdAt: Date;
};

type GraphRelation = {
  id: string;
  projectId: string;
  sourceEntityId: string;
  targetEntityId: string;
  relationType: string;
  evidenceChunkId: string | null;
  confidence: number | null;
  metadata: unknown;
  createdAt: Date;
};

export type RepoGraphQueryOutput = {
  status: "ok";
  query: string;
  depth: number;
  entities: GraphEntity[];
  relations: GraphRelation[];
  paths: Array<{
    source: GraphEntity;
    target: GraphEntity;
    relations: GraphRelation[];
    score: number;
  }>;
  answer: string;
  debug: {
    repoGraphUsed: boolean;
    graphPathUsed: boolean;
    graphPathCount: number;
    graphEntityCount: number;
    graphRelationCount: number;
    graphTraversalDepth: number;
    tokens: string[];
  };
};

const STOPWORDS = new Set([
  "the",
  "and",
  "how",
  "using",
  "repo",
  "graph",
  "which",
  "what",
  "where",
  "files",
  "file",
  "components",
  "component",
  "connect",
  "connects",
  "between",
  "from",
  "with",
  "does",
  "this",
  "that",
  "scout",
]);

const SYNONYMS: Record<string, string[]> = {
  router: ["router", "routeScoutQuery", "answerWithRouter", "router.service", "router.service.ts"],
  memory: ["memory", "MemoryManager", "memory-manager", "memory-manager.ts", "recallMemories", "writeSetupMemories"],
  runtime: ["runtime", "RLM runtime", "rlm-runtime", "pythonSandbox", "toolsClient"],
  rlm: ["RLM runtime", "rlm-runtime", "pythonSandbox", "toolsClient"],
  worker: ["worker", "BullMQ", "jobs", "queue"],
  tools: ["tools", "tools.service", "toolsClient", "webResearch", "githubRepo", "queryGraph"],
  api: ["api", "Fastify", "router", "tools.service"],
  orchestrator: ["ResearchOrchestrator", "research-orchestrator", "research-orchestrator.ts"],
};

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_.#/-]+/g, " ").replace(/\s+/g, " ").trim();
}

export function graphQueryTokens(query: string): string[] {
  const base = query
    .split(/[^A-Za-z0-9_.#/-]+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 3)
    .filter((x) => !STOPWORDS.has(x.toLowerCase()));

  const expanded = base.flatMap((token) => {
    const key = token.toLowerCase();
    return [token, ...(SYNONYMS[key] ?? [])];
  });

  return unique(expanded);
}

function entityScore(entity: GraphEntity, tokens: string[]): number {
  const name = normalize(entity.name);
  const desc = normalize(entity.description ?? "");
  const metadata = normalize(JSON.stringify(entity.metadata ?? {}));

  let score = 0;

  for (const token of tokens) {
    const t = normalize(token);
    if (!t) continue;

    if (name === t) score += 30;
    if (name.includes(t)) score += 20;
    if (desc.includes(t)) score += 8;
    if (metadata.includes(t)) score += 5;
  }

  if (entity.type === "file") score += 10;
  if (entity.type === "symbol") score += 3;
  if (entity.type === "service") score += 2;

  return score;
}

const RELATION_WEIGHTS: Record<string, number> = {
  FILE_IMPORTS_FILE: 12,
  FILE_DEFINES_SYMBOL: 10,
  SERVICE_OWNS_FILE: 8,
  contains: 10,
  imports: 8,
  depends_on: 5,
  call: 12,
  calls: 12,
  defines: 10,
};

function relationWeight(relationType: string): number {
  return RELATION_WEIGHTS[relationType] ?? 1;
}

async function getMatchedEntities(projectId: string, tokens: string[]): Promise<GraphEntity[]> {
  const or =
    tokens.length > 0
      ? tokens.flatMap((token) => [
          { name: { contains: token, mode: "insensitive" as const } },
          { description: { contains: token, mode: "insensitive" as const } },
        ])
      : [];

  const entities = await prisma.entity.findMany({
    where: {
      projectId,
      ...(or.length ? { OR: or } : {}),
    },
    orderBy: { name: "asc" },
    take: 500,
  });

  return entities
    .map((entity) => ({ entity, score: entityScore(entity, tokens) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.entity.name.localeCompare(b.entity.name))
    .slice(0, 30)
    .map((item) => item.entity);
}

async function expandRelations(projectId: string, seedIds: string[], depth: number) {
  const seenEntityIds = new Set(seedIds);
  const seenRelationIds = new Set<string>();
  const frontier = new Set(seedIds);

  for (let level = 0; level < depth; level++) {
    if (frontier.size === 0) break;

    const current = [...frontier];
    frontier.clear();

    const relations = await prisma.relation.findMany({
      where: {
        projectId,
        OR: [
          { sourceEntityId: { in: current } },
          { targetEntityId: { in: current } },
        ],
      },
      take: 500,
    });

    for (const relation of relations) {
      seenRelationIds.add(relation.id);

      for (const entityId of [relation.sourceEntityId, relation.targetEntityId]) {
        if (!seenEntityIds.has(entityId)) {
          seenEntityIds.add(entityId);
          frontier.add(entityId);
        }
      }
    }
  }

  const [entities, relations] = await Promise.all([
    prisma.entity.findMany({
      where: { projectId, id: { in: [...seenEntityIds] } },
      orderBy: { name: "asc" },
      take: 300,
    }),
    prisma.relation.findMany({
      where: { projectId, id: { in: [...seenRelationIds] } },
      take: 500,
    }),
  ]);

  return { entities, relations };
}

function buildGraphPaths(input: {
  entities: GraphEntity[];
  relations: GraphRelation[];
  tokens: string[];
}) {
  const byId = new Map(input.entities.map((entity) => [entity.id, entity]));
  const matched = input.entities
    .map((entity) => ({ entity, score: entityScore(entity, input.tokens) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);

  const paths = [];

  for (const item of matched) {
    const touching = input.relations
      .filter(
        (relation) =>
          relation.sourceEntityId === item.entity.id ||
          relation.targetEntityId === item.entity.id,
      )
      .sort((a, b) => relationWeight(b.relationType) - relationWeight(a.relationType))
      .slice(0, 6);

    for (const relation of touching) {
      const otherId =
        relation.sourceEntityId === item.entity.id
          ? relation.targetEntityId
          : relation.sourceEntityId;

      const other = byId.get(otherId);
      if (!other) continue;

      paths.push({
        source: byId.get(relation.sourceEntityId) ?? item.entity,
        target: byId.get(relation.targetEntityId) ?? other,
        relations: [relation],
        score: item.score + relationWeight(relation.relationType) + entityScore(other, input.tokens),
      });
    }
  }

  return paths.sort((a, b) => b.score - a.score).slice(0, 15);
}

function renderEntityGroup(title: string, entities: GraphEntity[], tokens?: string[]): string[] {
  if (entities.length === 0) return [];

  const sorted = [...entities];
  if (tokens && tokens.length > 0) {
    sorted.sort((a, b) => {
      const scoreA = tokenMatchScore(a, tokens);
      const scoreB = tokenMatchScore(b, tokens);
      return scoreB - scoreA || a.name.localeCompare(b.name);
    });
  }

  return [
    `### ${title}`,
    "",
    ...sorted.slice(0, 12).map((entity) => `- \`${entity.name}\` (${entity.type})`),
    "",
  ];
}

function tokenMatchScore(entity: GraphEntity, tokens: string[]): number {
  const name = normalize(entity.name);
  let score = 0;
  for (const token of tokens) {
    const t = normalize(token);
    if (!t) continue;
    if (name === t) score += 5;
    else if (name.includes(t)) score += 3;
  }
  return score;
}

function renderRepoGraphAnswer(input: {
  query: string;
  entities: GraphEntity[];
  relations: GraphRelation[];
  paths: Array<{
    source: GraphEntity;
    target: GraphEntity;
    relations: GraphRelation[];
    score: number;
  }>;
  tokens?: string[];
}): string {
  const lines: string[] = [];

  lines.push("## Repo graph answer");
  lines.push("");

  if (input.entities.length === 0 && input.relations.length === 0) {
    lines.push("I could not find matching repo graph entities or relations for this query.");
    return lines.join("\n");
  }

  lines.push(
    `Found ${input.entities.length} graph entities, ${input.relations.length} relations, and ${input.paths.length} relevant connection path(s).`,
  );
  lines.push("");

  if (input.paths.length > 0) {
    lines.push("### Most relevant connection paths");
    lines.push("");

    for (const path of input.paths.slice(0, 8)) {
      const relation = path.relations[0];
      lines.push(
        `- \`${path.source.name}\` --${relation.relationType}--> \`${path.target.name}\``,
      );
    }

    lines.push("");
  }

  const files = input.entities.filter((entity) => entity.type === "file");
  const symbols = input.entities.filter((entity) => entity.type === "symbol");
  const services = input.entities.filter((entity) => entity.type === "service");
  const deps = input.entities.filter((entity) => entity.type === "dependency");

  lines.push(...renderEntityGroup("Relevant services/packages", services, input.tokens));
  lines.push(...renderEntityGroup("Relevant files", files, input.tokens));
  lines.push(...renderEntityGroup("Relevant symbols", symbols, input.tokens));
  lines.push(...renderEntityGroup("Relevant dependencies", deps, input.tokens));

  lines.push("### Interpretation");
  lines.push("");
  lines.push(
    "The answer above is generated from the persisted repo graph. The strongest evidence is the explicit file/import/symbol relationships shown in the connection paths.",
  );

  return lines.join("\n");
}

async function getAllEntities(projectId: string): Promise<GraphEntity[]> {
  return prisma.entity.findMany({
    where: { projectId },
    orderBy: { name: "asc" },
    take: 300,
  });
}

export async function queryRepoGraph(input: {
  projectId: string;
  query: string;
  depth?: number;
}): Promise<RepoGraphQueryOutput> {
  const depth = input.depth ?? 2;
  const tokens = graphQueryTokens(input.query);
  let matched = await getMatchedEntities(input.projectId, tokens);

  // Fallback: return top entities when token search has no matches
  if (matched.length === 0) {
    matched = await getAllEntities(input.projectId);
  }

  if (matched.length === 0) {
    const answer = "I could not find matching repo graph entities for this query.";

    return {
      status: "ok",
      query: input.query,
      depth,
      entities: [],
      relations: [],
      paths: [],
      answer,
      debug: {
        repoGraphUsed: false,
        graphPathUsed: false,
        graphPathCount: 0,
        graphEntityCount: 0,
        graphRelationCount: 0,
        graphTraversalDepth: depth,
        tokens,
      },
    };
  }

  const expanded = await expandRelations(
    input.projectId,
    matched.map((entity) => entity.id),
    depth,
  );

  const paths = buildGraphPaths({
    entities: expanded.entities,
    relations: expanded.relations,
    tokens,
  });

  const answer = renderRepoGraphAnswer({
    query: input.query,
    entities: expanded.entities,
    relations: expanded.relations,
    paths,
    tokens,
  });

  return {
    status: "ok",
    query: input.query,
    depth,
    entities: expanded.entities,
    relations: expanded.relations,
    paths,
    answer,
    debug: {
      repoGraphUsed: expanded.entities.length > 0 || expanded.relations.length > 0,
      graphPathUsed: paths.length > 0,
      graphPathCount: paths.length,
      graphEntityCount: expanded.entities.length,
      graphRelationCount: expanded.relations.length,
      graphTraversalDepth: depth,
      tokens,
    },
  };
}
