import "dotenv/config";
import { createHash } from "node:crypto";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";
import { prisma } from "./db.js";
import { researchQueue } from "./queue.js";

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

function hashText(text: string) {
  return createHash("sha256").update(text).digest("hex");
}

app.post("/tools/crawl-url", async (req) => {
  const body = z.object({
    projectId: z.string().uuid().optional(),
    url: z.string().url(),
    maxPages: z.number().int().min(1).max(20).optional(),
  }).parse(req.body);

  const apiKey = process.env.FIRECRAWL_API_KEY;

  if (!apiKey) {
    return { status: "error", error: "FIRECRAWL_API_KEY is not configured" };
  }

  const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ url: body.url, formats: ["markdown"] }),
  });

  if (!response.ok) {
    const text = await response.text();
    return { status: "error", error: `Firecrawl failed: ${response.status} ${text}` };
  }

  const data = await response.json();
  const markdown = data?.data?.markdown || data?.markdown || data?.data?.content || "";
  const title = data?.data?.metadata?.title || data?.data?.title || body.url;
  const contentHash = hashText(markdown || body.url);
  let document = null;

  if (body.projectId && markdown) {
    const existing = await prisma.document.findFirst({
      where: { projectId: body.projectId, contentHash },
    });
    document = existing ||
      await prisma.document.create({
        data: {
          projectId: body.projectId,
          sourceUrl: body.url,
          title,
          markdown,
          contentHash,
          metadata: { provider: "firecrawl", url: body.url },
        },
      });
  }

  return {
    status: "ok",
    url: body.url,
    title,
    markdownPreview: markdown.slice(0, 3000),
    documentId: document?.id ?? null,
  };
});

app.post("/tools/search-kb", async (req) => {
  const body = z.object({
    projectId: z.string().uuid().optional(),
    query: z.string().min(1),
    topK: z.number().int().min(1).max(20).optional(),
  }).parse(req.body);

  const topK = body.topK ?? 5;

  const documents = await prisma.document.findMany({
    where: {
      ...(body.projectId ? { projectId: body.projectId } : {}),
      OR: [
        { title: { contains: body.query, mode: "insensitive" } },
        { markdown: { contains: body.query, mode: "insensitive" } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: topK,
  });

  return {
    status: "ok",
    query: body.query,
    results: documents.map((doc) => ({
      documentId: doc.id,
      title: doc.title,
      sourceUrl: doc.sourceUrl,
      preview: doc.markdown.slice(0, 1200),
    })),
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

const port = Number(process.env.API_PORT || 8000);
await app.listen({ host: "0.0.0.0", port });
