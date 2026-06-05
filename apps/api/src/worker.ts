import "dotenv/config";
import { Worker } from "bullmq";
import { prisma } from "./db.js";
import { redisConnection } from "./queue.js";

const runtimeUrl = process.env.RLM_RUNTIME_URL || "http://rlm-runtime:8787";

function readable(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

new Worker(
  "research-jobs",
  async (job) => {
    const { researchJobId } = job.data as { researchJobId: string };

    const researchJob = await prisma.researchJob.update({
      where: { id: researchJobId },
      data: { status: "RUNNING" },
    });

    const run = await prisma.agentRun.create({
      data: {
        projectId: researchJob.projectId,
        jobId: researchJob.id,
        query: researchJob.question,
        depth: 0,
        status: "RUNNING",
      },
    });

    try {
      const resp = await fetch(`${runtimeUrl}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId: run.id,
          projectId: researchJob.projectId,
          query: researchJob.question,
          maxSteps: 5,
          maxDepth: 2,
        }),
      });

      const result = await resp.json();

      await prisma.agentStep.create({
        data: {
          runId: run.id,
          stepIndex: 0,
          stdout: readable(result),
          result,
        },
      });

      const answer =
        result?.final !== undefined && result?.final !== null
          ? readable(result.final)
          : result?.error
            ? readable(result.error)
            : readable(result);

      await prisma.report.create({
        data: {
          projectId: researchJob.projectId,
          jobId: researchJob.id,
          title: "RLM Answer",
          content: answer,
          metadata: { result },
        },
      });

      await prisma.agentRun.update({
        where: { id: run.id },
        data: {
          status: result.status === "completed" ? "COMPLETED" : "FAILED",
          finalOutput: result,
        },
      });

      await prisma.researchJob.update({
        where: { id: researchJob.id },
        data: {
          status: result.status === "completed" ? "COMPLETED" : "FAILED",
          error: result.error ?? null,
        },
      });

      return { status: result.status };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      await prisma.agentRun.update({
        where: { id: run.id },
        data: { status: "FAILED", finalOutput: { error: message } },
      });

      await prisma.researchJob.update({
        where: { id: researchJob.id },
        data: { status: "FAILED", error: message },
      });

      throw error;
    }
  },
  { connection: redisConnection }
);

console.log("RLM Forge worker running...");
