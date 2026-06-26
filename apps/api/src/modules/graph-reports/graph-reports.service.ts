import { prisma } from "@rlm-forge/database/prisma.js";

export async function getLatestGraphReport(input: { projectId: string }) {
  return prisma.report.findFirst({
    where: {
      projectId: input.projectId,
      metadata: {
        path: ["source"],
        equals: "repo_graph_report",
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getGraphReportById(input: { reportId: string }) {
  return prisma.report.findFirst({
    where: {
      id: input.reportId,
      metadata: {
        path: ["source"],
        equals: "repo_graph_report",
      },
    },
  });
}

export function graphReportFilename(report?: { title?: string }) {
  const base = report?.title || "GRAPH_REPORT";
  return `${base
    .replace(/^Repo Graph Report:\s*/i, "")
    .replace(/[^a-z0-9_-]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "GRAPH_REPORT"}.md`;
}
