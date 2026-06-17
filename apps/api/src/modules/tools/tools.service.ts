import {
  buildEvidencePack,
  ingestMarkdownDocument,
  normalizeResearchQuery,
  planResources,
  preview,
  ResearchOrchestrator,
  scrapePageWithScrapling,
  crawlSiteWithScrapling,
  extractEvidenceFromPage,
  scrapeUrl,
} from "@rlm-forge/knowledge";

import { searchKnowledgeBase as runKnowledgeSearch } from "@rlm-forge/retrieval";
import { queryRepoGraph } from "@rlm-forge/knowledge/graph/repo-graph-query.js";
import { prisma } from "@rlm-forge/database/prisma.js";
import type {
  CrawlUrlInput,
  PlanResourcesInput,
  QueryGraphInput,
  SearchKbInput,
  WebResearchInput,
  GithubRepoInput,
} from "./tools.schema.js";
import { buildResearchResponse } from "./research-response-contract.js";

const MODEL_SERVICE_URL =
  process.env.MODEL_SERVICE_URL || "http://model-service:8100";

export async function crawlUrl(input: CrawlUrlInput) {
  const crawl = await crawlSiteWithScrapling({
    rootUrl: input.url,
    maxPages: input.maxPages ?? 1,
    maxDepth: input.maxDepth ?? 0,
    mode: "auto",
    aiTargeted: true,
    sameDomainOnly: true,
  });

  const documents = [];

  for (const page of crawl.pages) {
    const ingested = await ingestMarkdownDocument({
      projectId: input.projectId,
      sourceUrl: page.url,
      title: page.title,
      markdown: page.markdown,
      metadata: page.metadata,
    });

    documents.push({
      url: page.url,
      title: page.title,
      documentId: ingested.document.id,
      chunksCreated: ingested.chunksCreated,
      chunksTotal: ingested.chunksTotal,
      embeddedChunks: ingested.embeddedChunks,
      embeddingError: ingested.embeddingError,
      deduped: ingested.deduped,
      markdownPreview: preview(page.markdown, 1200),
    });
  }

  return {
    status: "ok",
    rootUrl: crawl.rootUrl,
    documents,
    failedUrls: crawl.failedUrls,
    pagesCrawled: documents.length,
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

export async function planResearchResources(input: PlanResourcesInput) {
  const maxSources = input.maxResults ?? 10;

  const plan = await planResources({
    query: input.query,
    maxSources,
  });

  return {
    status: "ok",
    query: input.query,
    normalizedQuery: plan.normalizedQuery,
    strategy: plan.strategy,
    resourcesPlanned: plan.resources.map((resource) => ({
      title: resource.title,
      url: resource.url,
      product: resource.product,
      domain: resource.domain,
      tier: resource.tier,
      source: resource.source,
      score: resource.score,
      matchedBy: resource.matchedBy,
      reason: resource.reason,
    })),
  };
}

export async function webResearch(input: WebResearchInput) {
  if (input.useOrchestrator) {
    const orchestrator = new ResearchOrchestrator();
    const raw = await orchestrator.run({
      projectId: input.projectId,
      userId: input.userId,
      query: input.query,
      maxSources: input.maxResults,
      maxPagesPerSource: input.maxPagesPerSource,
      maxTotalPages: input.maxTotalPages,
      maxDepth: input.maxDepth,
    });
    return buildResearchResponse(raw);
  }

  const maxSources = input.maxResults ?? 10;

  const plan = await planResources({
    query: input.query,
    maxSources,
  });

  const documents = [];
  const evidence = [];
  const failedScrapes = [];

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

  for (let index = 0; index < scrapeResults.length; index++) {
    const result = scrapeResults[index];
    const plannedResource = plan.resources[index];

    if (result.status !== "fulfilled") {
      failedScrapes.push({
        title: plannedResource?.title,
        url: plannedResource?.url,
        product: plannedResource?.product,
        domain: plannedResource?.domain,
        tier: plannedResource?.tier,
        reason: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });

      continue;
    }

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

    const extractedEvidence = extractEvidenceFromPage({
      title: scraped.title || resource.title,
      url: scraped.url,
      markdown: scraped.markdown,
      product: resource.product,
      domain: resource.domain,
      tier: resource.tier,
      reason: resource.reason,
      metadata: {
        sourceType: resource.source,
        matchedScore: resource.score,
        matchedBy: resource.matchedBy,
        normalizedQuery: plan.normalizedQuery,
      },
    });

    if (extractedEvidence.length > 0) {
      evidence.push(...extractedEvidence);
    } else {
      const quote = preview(scraped.markdown, 500);
      evidence.push({
        claim: `Source "${scraped.title || resource.title}" contains potentially relevant information for the query.`,
        quote,
        title: scraped.title || resource.title,
        url: scraped.url,
        product: resource.product,
        domain: resource.domain,
        tier: resource.tier,
        confidence:
          resource.tier === "official_docs" || resource.tier === "trusted_docs"
            ? 0.72
            : 0.55,
        entities: [resource.product, resource.domain].filter(Boolean) as string[],
        reason: resource.reason,
        text: quote,
        metadata: {
          fallbackEvidence: true,
          sourceType: resource.source,
          matchedScore: resource.score,
          matchedBy: resource.matchedBy,
          normalizedQuery: plan.normalizedQuery,
        },
      });
    }
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
    failedScrapes,
    evidencePack,
    results: evidence,
  };
}

type GitHubRepoParsed = { owner: string; repo: string };
type GitHubTreeItem = { path?: string; type?: string; size?: number };
function parseGithubRepo(input: string): GitHubRepoParsed {
  const s = input.trim();
  const u = s.match(/^https?:\/\/github\.com\/([^/\s]+)\/([^/\s?#]+)(?:[/?#].*)?$/i);
  if (u) return { owner: u[1], repo: u[2].replace(/\.git$/i, "") };
  const r = s.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (r) return { owner: r[1], repo: r[2].replace(/\.git$/i, "") };
  throw new Error("Expected GitHub repository URL or owner/repo");
}
function ghHeaders(): HeadersInit { return { Accept:"application/vnd.github+json", "User-Agent":"Scout-GitHub-Repo-Tool", ...(process.env.GITHUB_TOKEN ? { Authorization:`Bearer ${process.env.GITHUB_TOKEN}` } : {}) }; }
async function ghJson<T>(url: string): Promise<T> { const res = await fetch(url,{headers:ghHeaders()}); if(!res.ok) throw new Error(`GitHub request failed: ${res.status} ${await res.text()}`); return res.json() as Promise<T>; }
async function ghRaw(owner:string, repo:string, branch:string, path:string): Promise<string|null> { const raw=`https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${path.split("/").map(encodeURIComponent).join("/")}`; const res=await fetch(raw,{headers:{"User-Agent":"Scout-GitHub-Repo-Tool",...(process.env.GITHUB_TOKEN?{Authorization:`Bearer ${process.env.GITHUB_TOKEN}`}:{})}}); return res.ok ? res.text() : null; }
function rankRepoPath(path: string): number { const x=path.toLowerCase(); if(x==="readme.md")return 1000; if(x==="package.json")return 950; if(x==="docker-compose.yml"||x==="docker-compose.yaml")return 930; if(x==="prisma/schema.prisma")return 920; if(x.endsWith("/package.json"))return 880; if(x.endsWith("dockerfile"))return 820; if(x.startsWith("docs/"))return 760; if(/^(apps|packages)\//.test(x)&&/(main|server|router|service|schema|client|index|manager|worker|runtime|tools|memory)\.(ts|tsx|js|py)$/.test(x))return 720; if(x.includes("__tests__")||x.endsWith(".test.ts")||x.endsWith(".spec.ts"))return 500; if(/\.(ts|tsx|js|py|md|prisma|yml|yaml|json)$/.test(x))return 200; return 0; }
function clip(text:string,max=3500){const t=text.replace(/\r\n/g,"\n").trim(); return t.length<=max?t:t.slice(0,max)+"\n...[truncated]";}
function stackFrom(paths:string[], pkgs:string[]): string[] { const s=new Set<string>(); if(paths.some(p=>p.startsWith("apps/web/")))s.add("Next.js/web app"); if(paths.some(p=>p.startsWith("apps/api/")))s.add("API service"); if(paths.some(p=>p.startsWith("apps/worker/")))s.add("background worker"); if(paths.some(p=>p.startsWith("apps/model-service/")))s.add("Python model service"); if(paths.some(p=>p.startsWith("apps/rlm-runtime/")))s.add("RLM runtime"); if(paths.some(p=>p.startsWith("packages/")))s.add("monorepo packages"); if(paths.some(p=>p==="docker-compose.yml"||p==="docker-compose.yaml"))s.add("Docker Compose"); if(paths.some(p=>p==="prisma/schema.prisma"))s.add("Prisma/Postgres"); if(pkgs.some(t=>t.includes("bullmq")))s.add("BullMQ/Redis"); if(pkgs.some(t=>t.includes("fastify")))s.add("Fastify"); if(pkgs.some(t=>t.includes("qdrant")))s.add("Qdrant/vector retrieval"); return [...s]; }
function repoAnswer(i:{fullName:string;htmlUrl:string;description?:string|null;defaultBranch:string;selectedFiles:string[];stack:string[];files:Array<{path:string;text:string}>}){ const out:string[]=[]; out.push(`# ${i.fullName}`,""); if(i.description) out.push(i.description,""); out.push("## What this repository appears to contain",""); out.push(i.stack.length?`Detected stack/components: ${i.stack.join(", ")}.`:"Detected stack/components were not obvious from selected files.",""); out.push("## Key files inspected",""); for(const f of i.selectedFiles.slice(0,20)) out.push(`- \`${f}\``); out.push("","## High-level structure",""); for(const f of [...new Set(i.selectedFiles.map(p=>p.split("/")[0]))].slice(0,12)) out.push(`- \`${f}\``); out.push("","## Notes from selected files",""); for(const f of i.files.slice(0,8)){ const first=f.text.split("\n").map(l=>l.trim()).filter(l=>l&&!l.startsWith("#")&&!l.startsWith("//")).slice(0,3).join(" "); out.push(`- \`${f.path}\`: ${first||"File inspected."}`); } out.push("","## Source",i.htmlUrl); return out.join("\n"); }

export async function githubRepo(input: GithubRepoInput) {
  const parsed = parseGithubRepo(input.url);
  const maxFiles = input.maxFiles ?? (input.mode === "deep" ? 50 : 30);
  const repo = await ghJson<{full_name:string;html_url:string;description?:string|null;default_branch?:string}>(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}`);
  const branch = repo.default_branch || "main";
  const tree = await ghJson<{tree:GitHubTreeItem[]}>(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
  const paths = (tree.tree ?? []).filter(x=>x.type==="blob"&&x.path).map(x=>x.path as string);
  const selectedFiles = paths.map(path=>({path,score:rankRepoPath(path)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||a.path.localeCompare(b.path)).slice(0,maxFiles).map(x=>x.path);
  const files:Array<{path:string;text:string}>=[];
  for (const path of selectedFiles) { const raw = await ghRaw(parsed.owner, parsed.repo, branch, path); if(raw?.trim()) files.push({path,text:clip(raw,path.toLowerCase().endsWith(".json")?2200:3500)}); }
  const pkgs = files.filter(f=>f.path.toLowerCase().endsWith("package.json")).map(f=>f.text);
  const stack = stackFrom(paths, pkgs);
  const answer = repoAnswer({fullName:repo.full_name,htmlUrl:repo.html_url,description:repo.description,defaultBranch:branch,selectedFiles,stack,files});
  return { status:"ok", repo:repo.full_name, url:repo.html_url, defaultBranch:branch, fileCount:paths.length, selectedFileCount:selectedFiles.length, selectedFiles, stack, files, answer, sources:[{title:repo.full_name,url:repo.html_url}] };
}

export async function queryGraph(input: QueryGraphInput) {
  if (!input.projectId) {
    return {
      status: "ok",
      query: input.query,
      depth: input.depth ?? 1,
      entities: [],
      relations: [],
      paths: [],
      answer: "A projectId is required to query the repo graph.",
      markdown: "A projectId is required to query the repo graph.",
      debug: {
        repoGraphUsed: false,
        graphPathUsed: false,
        graphPathCount: 0,
        graphEntityCount: 0,
        graphRelationCount: 0,
        graphTraversalDepth: input.depth ?? 1,
      },
    };
  }

  return queryRepoGraph({
    projectId: input.projectId,
    query: input.query,
    depth: input.depth ?? 2,
  });
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
