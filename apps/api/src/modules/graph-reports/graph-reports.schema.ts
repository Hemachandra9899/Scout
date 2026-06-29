import { z } from "zod";

export const latestGraphReportQuerySchema = z.object({
  projectId: z.string().uuid(),
  format: z.enum(["json", "md"]).optional(),
});

export const graphReportParamsSchema = z.object({
  reportId: z.string().uuid(),
});
