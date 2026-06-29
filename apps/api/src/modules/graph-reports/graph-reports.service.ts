import { prisma } from "@rlm-forge/database/prisma.js";
import { cacheWrap, graphReportCacheKey, CACHE_GRAPH_REPORT_TTL_MS } from "@rlm-forge/knowledge/cache/index.js";

export async function getLatestGraphReport(input: { projectId: string }) {
  const key = graphReportCacheKey(input);
  const { value } = await cacheWrap(
    key,
    () => prisma.report.findFirst({
      where: {
        projectId: input.projectId,
        metadata: {
          path: ["source"],
          equals: "repo_graph_report",
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    CACHE_GRAPH_REPORT_TTL_MS,
  );
  return value;
}

export async function getGraphReportById(input: { reportId: string }) {
  const key = graphReportCacheKey(input);
  const { value } = await cacheWrap(
    key,
    () => prisma.report.findFirst({
      where: {
        id: input.reportId,
        metadata: {
          path: ["source"],
          equals: "repo_graph_report",
        },
      },
    }),
    CACHE_GRAPH_REPORT_TTL_MS,
  );
  return value;
}

export function graphReportFilename(report?: { title?: string }) {
  const base = report?.title || "GRAPH_REPORT";
  return `${base
    .replace(/^Repo Graph Report:\s*/i, "")
    .replace(/[^a-z0-9_-]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "GRAPH_REPORT"}.md`;
}
