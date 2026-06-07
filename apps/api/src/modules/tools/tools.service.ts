import {
  buildEvidencePack,
  ingestMarkdownDocument,
  normalizeResearchQuery,
  planResources,
  preview,
  scrapePageWithScrapling,
  scrapeUrl,
} from "@rlm-forge/knowledge";

import { searchKnowledgeBase as runKnowledgeSearch } from "@rlm-forge/retrieval";
import { prisma } from "@rlm-forge/database/prisma.js";
import type {
  CrawlUrlInput,
  QueryGraphInput,
  SearchKbInput,
  WebResearchInput,
} from "./tools.schema.js";

const MODEL_SERVICE_URL =
  process.env.MODEL_SERVICE_URL || "http://model-service:8100";

export async function crawlUrl(input: CrawlUrlInput) {
  const scraped = await scrapeUrl(input.url);

  const ingested = await ingestMarkdownDocument({
    projectId: input.projectId,
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
    embeddedChunks: ingested.embeddedChunks,
    embeddingError: ingested.embeddingError,
    deduped: ingested.deduped,
    markdownPreview: preview(scraped.markdown, 2000),
  };
}

export async function searchKnowledgeBase(input: SearchKbInput) {
  const normalizedQuery = normalizeResearchQuery(input.query);

  const search = await runKnowledgeSearch({
    projectId: input.projectId,
    query: normalizedQuery,
    topK: input.topK ?? 10,
  });

  return {
    status: "ok",
    query: input.query,
    normalizedQuery,
    retrieval: search.retrieval,
    retrievalError: search.error,
    results: search.results,
  };
}

export async function webResearch(input: WebResearchInput) {
  const maxSources = input.maxResults ?? 10;

  const plan = await planResources({
    query: input.query,
    maxSources,
  });

  const documents = [];
  const evidence = [];

  const scrapeResults = await Promise.allSettled(
    plan.resources.map(async (resource) => {
      const scraped = await scrapePageWithScrapling(resource.url);

      if (!scraped.markdown || scraped.markdown.trim().length < 250) {
        throw new Error("Scraped markdown was too short.");
      }

      const ingested = await ingestMarkdownDocument({
        projectId: input.projectId,
        sourceUrl: scraped.url,
        title: scraped.title || resource.title,
        markdown: scraped.markdown,
        metadata: {
          provider: "scrapling",
          sourceType: resource.source,
          product: resource.product,
          domain: resource.domain,
          tier: resource.tier,
          topics: resource.topics || [],
          matchedScore: resource.score,
          matchedBy: resource.matchedBy,
          normalizedQuery: plan.normalizedQuery,
        },
      });

      return {
        resource,
        scraped,
        ingested,
      };
    })
  );

  for (const result of scrapeResults) {
    if (result.status !== "fulfilled") continue;

    const { resource, scraped, ingested } = result.value;

    documents.push({
      documentId: ingested.document.id,
      title: scraped.title || resource.title,
      url: scraped.url,
      product: resource.product,
      domain: resource.domain,
      tier: resource.tier,
      sourceType: resource.source,
      chunksTotal: ingested.chunksTotal,
      embeddedChunks: ingested.embeddedChunks,
      embeddingError: ingested.embeddingError,
      deduped: ingested.deduped,
    });

    evidence.push({
      title: scraped.title || resource.title,
      url: scraped.url,
      product: resource.product,
      domain: resource.domain,
      tier: resource.tier,
      text: preview(scraped.markdown, 1800),
      reason: resource.reason,
    });
  }

  const evidencePack = buildEvidencePack({
    query: input.query,
    resourcesPlanned: plan.resources,
    evidence,
  });

  return {
    status: "ok",
    query: input.query,
    normalizedQuery: plan.normalizedQuery,
    strategy: plan.strategy,
    resourcesPlanned: plan.resources,
    documents,
    evidencePack,
    results: evidence,
  };
}

export async function queryGraph(input: QueryGraphInput) {

  const entities = await prisma.entity.findMany({
    where: {
      ...(input.projectId ? { projectId: input.projectId } : {}),
      OR: [
        { name: { contains: input.query, mode: "insensitive" } },
        { description: { contains: input.query, mode: "insensitive" } },
      ],
    },
    take: 10,
  });

  const entityIds = entities.map((e: { id: string }) => e.id);
  const relations = entityIds.length
    ? await prisma.relation.findMany({
        where: {
          ...(input.projectId ? { projectId: input.projectId } : {}),
          OR: [
            { sourceEntityId: { in: entityIds } },
            { targetEntityId: { in: entityIds } },
          ],
        },
        take: 20,
      })
    : [];

  return { status: "ok", query: input.query, depth: input.depth ?? 1, entities, relations };
}

export async function convertFileWithMarkItDown(input: {
  buffer: Buffer;
  filename: string;
  contentType?: string;
  sourceUrl?: string;
}) {
  const formData = new FormData();

  formData.append(
    "file",
    new Blob([new Uint8Array(input.buffer)], {
      type: input.contentType || "application/octet-stream",
    }),
    input.filename
  );

  if (input.sourceUrl) {
    formData.append("source_url", input.sourceUrl);
  }

  const response = await fetch(`${MODEL_SERVICE_URL}/convert/file`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`model-service /convert/file failed: ${response.status} ${text}`);
  }

  return await response.json();
}

export async function ingestFile(args: {
  projectId: string;
  uploadedFile: {
    buffer: Buffer;
    filename: string;
    contentType?: string;
  };
  sourceUrl?: string;
}) {
  const converted = await convertFileWithMarkItDown({
    buffer: args.uploadedFile.buffer,
    filename: args.uploadedFile.filename,
    contentType: args.uploadedFile.contentType,
    sourceUrl: args.sourceUrl,
  });

  const markdown = String(converted.markdown || "");

  if (!markdown.trim()) {
    return {
      status: "error",
      error: "Converted markdown is empty",
    };
  }

  const ingested = await ingestMarkdownDocument({
    projectId: args.projectId,
    sourceUrl: args.sourceUrl || args.uploadedFile.filename,
    title: converted.title || args.uploadedFile.filename,
    markdown,
    metadata: {
      provider: "markitdown",
      filename: args.uploadedFile.filename,
      contentType: args.uploadedFile.contentType,
      sourceUrl: args.sourceUrl,
      conversionMetadata: converted.metadata || {},
    },
  });

  return {
    status: "ok",
    filename: args.uploadedFile.filename,
    title: converted.title || args.uploadedFile.filename,
    documentId: ingested.document.id,
    chunksCreated: ingested.chunksCreated,
    chunksTotal: ingested.chunksTotal,
    embeddedChunks: ingested.embeddedChunks,
    embeddingError: ingested.embeddingError,
    deduped: ingested.deduped,
    markdownPreview: preview(markdown, 2000),
  };
}
