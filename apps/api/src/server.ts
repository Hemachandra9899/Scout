import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";
import { prisma } from "./db.js";
import { researchQueue } from "./queue.js";
import { scrapeUrl } from "./lib/firecrawl.js";
import { ingestMarkdownDocument, searchChunks } from "./lib/ingestion.js";
import { preview } from "./lib/text.js";

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

app.get("/health", async () => {
  return { status: "ok", service: "api" };
});

app.get("/health/deps", async () => {
  const checks: Record<string, string> = {};

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.postgres = "ok";
  } catch (e: any) {
    checks.postgres = `error: ${e.message}`;
  }

  try {
    await researchQueue.getJobCounts();
    checks.redis = "ok";
  } catch (e: any) {
    checks.redis = `error: ${e.message}`;
  }

  try {
    const resp = await fetch(`${process.env.QDRANT_URL}/healthz`);
    checks.qdrant = resp.ok ? "ok" : `status ${resp.status}`;
  } catch (e: any) {
    checks.qdrant = `error: ${e.message}`;
  }

  try {
    const resp = await fetch(`${process.env.RLM_RUNTIME_URL}/health`);
    checks.rlmRuntime = resp.ok ? "ok" : `status ${resp.status}`;
  } catch (e: any) {
    checks.rlmRuntime = `error: ${e.message}`;
  }

  return checks;
});

app.post("/projects", async (req) => {
  const body = z.object({
    name: z.string().min(1),
    description: z.string().optional(),
  }).parse(req.body);

  return prisma.project.create({ data: body });
});

app.get("/projects", async () => {
  return prisma.project.findMany({
    orderBy: { createdAt: "desc" },
  });
});

app.get("/projects/:id/jobs", async (req) => {
  const params = z.object({ id: z.string().uuid() }).parse(req.params);

  return prisma.researchJob.findMany({
    where: { projectId: params.id },
    orderBy: { createdAt: "desc" },
    include: {
      reports: true,
      agentRuns: {
        include: { steps: true },
      },
    },
  });
});

app.post("/research-jobs", async (req) => {
  const body = z.object({
    projectId: z.string().uuid(),
    question: z.string().min(1),
  }).parse(req.body);

  const job = await prisma.researchJob.create({
    data: {
      projectId: body.projectId,
      question: body.question,
      status: "QUEUED",
    },
  });

  const queueJob = await researchQueue.add("run-research", {
    researchJobId: job.id,
  });

  return {
    jobId: job.id,
    queueJobId: queueJob.id,
    status: job.status,
  };
});

app.get("/research-jobs/:id", async (req) => {
  const params = z.object({ id: z.string().uuid() }).parse(req.params);

  return prisma.researchJob.findUnique({
    where: { id: params.id },
    include: {
      reports: true,
      agentRuns: {
        include: { steps: true },
      },
    },
  });
});

app.post("/tools/crawl-url", async (req) => {
  const body = z.object({
    projectId: z.string().uuid(),
    url: z.string().url(),
    maxPages: z.number().int().min(1).max(20).optional(),
  }).parse(req.body);

  const scraped = await scrapeUrl(body.url);

  const ingested = await ingestMarkdownDocument({
    projectId: body.projectId,
    sourceUrl: scraped.url,
    title: scraped.title,
    markdown: scraped.markdown,
    metadata: scraped.metadata,
  });

  return {
    status: "ok",
    url: scraped.url,
    title: scraped.title,
    documentId: ingested.document.id,
    chunksCreated: ingested.chunksCreated,
    chunksTotal: ingested.chunksTotal,
    deduped: ingested.deduped,
    markdownPreview: preview(scraped.markdown, 2000),
  };
});

app.post("/tools/search-kb", async (req) => {
  const body = z.object({
    projectId: z.string().uuid().optional(),
    query: z.string().min(1),
    topK: z.number().int().min(1).max(20).optional(),
  }).parse(req.body);

  const results = await searchChunks({
    projectId: body.projectId,
    query: body.query,
    topK: body.topK ?? 5,
  });

  return {
    status: "ok",
    query: body.query,
    results,
  };
});

app.post("/tools/query-graph", async (req) => {
  const body = z.object({
    projectId: z.string().uuid().optional(),
    query: z.string().min(1),
    depth: z.number().int().min(1).max(3).optional(),
  }).parse(req.body);

  const entities = await prisma.entity.findMany({
    where: {
      ...(body.projectId ? { projectId: body.projectId } : {}),
      OR: [
        { name: { contains: body.query, mode: "insensitive" } },
        { description: { contains: body.query, mode: "insensitive" } },
      ],
    },
    take: 10,
  });

  const entityIds = entities.map((e: { id: string }) => e.id);
  const relations = entityIds.length
    ? await prisma.relation.findMany({
        where: {
          ...(body.projectId ? { projectId: body.projectId } : {}),
          OR: [
            { sourceEntityId: { in: entityIds } },
            { targetEntityId: { in: entityIds } },
          ],
        },
        take: 20,
      })
    : [];

  return { status: "ok", query: body.query, depth: body.depth ?? 1, entities, relations };
});

app.get("/projects/:id/documents", async (req) => {
  const params = z.object({ id: z.string().uuid() }).parse(req.params);

  return prisma.document.findMany({
    where: {
      projectId: params.id,
    },
    orderBy: {
      createdAt: "desc",
    },
    include: {
      _count: {
        select: {
          chunks: true,
        },
      },
    },
  });
});

app.get("/documents/:id/chunks", async (req) => {
  const params = z.object({ id: z.string().uuid() }).parse(req.params);

  return prisma.chunk.findMany({
    where: {
      documentId: params.id,
    },
    orderBy: {
      chunkIndex: "asc",
    },
  });
});

const port = Number(process.env.API_PORT || 8000);
await app.listen({ host: "0.0.0.0", port });
