import type { FastifyInstance } from "fastify";
import {
  graphReportParamsSchema,
  latestGraphReportQuerySchema,
} from "./graph-reports.schema.js";
import {
  getGraphReportById,
  getLatestGraphReport,
  graphReportFilename,
} from "./graph-reports.service.js";

export async function graphReportsRouter(app: FastifyInstance) {
  app.get("/graph-reports/latest", async (req, reply) => {
    const query = latestGraphReportQuerySchema.parse(req.query);
    const report = await getLatestGraphReport({ projectId: query.projectId });

    if (!report) {
      reply.code(404);
      return { error: "No repo graph report found for this project." };
    }

    if (query.format === "md") {
      reply
        .type("text/markdown; charset=utf-8")
        .header("Content-Disposition", `attachment; filename="${graphReportFilename(report)}"`);
      return report.content;
    }

    return {
      status: "ok",
      report,
      download: {
        markdown: `/graph-reports/${report.id}/download.md`,
        json: `/graph-reports/${report.id}`,
      },
    };
  });

  app.get("/graph-reports/:reportId", async (req, reply) => {
    const params = graphReportParamsSchema.parse(req.params);
    const report = await getGraphReportById({ reportId: params.reportId });

    if (!report) {
      reply.code(404);
      return { error: "Repo graph report not found." };
    }

    return {
      status: "ok",
      report,
      download: {
        markdown: `/graph-reports/${report.id}/download.md`,
        json: `/graph-reports/${report.id}`,
      },
    };
  });

  app.get("/graph-reports/:reportId/download.md", async (req, reply) => {
    const params = graphReportParamsSchema.parse(req.params);
    const report = await getGraphReportById({ reportId: params.reportId });

    if (!report) {
      reply.code(404);
      return "Repo graph report not found.";
    }

    reply
      .type("text/markdown; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="${graphReportFilename(report)}"`);
    return report.content;
  });
}
