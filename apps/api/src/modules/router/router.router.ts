import type { FastifyInstance } from "fastify";
import { prisma } from "@rlm-forge/database/prisma.js";
import { routerAnswerSchema } from "./router.schema.js";
import { answerWithRouter } from "./router.service.js";

async function ensureRouterProject(projectId: string) {
  await prisma.project.upsert({
    where: { id: projectId },
    update: {},
    create: {
      id: projectId,
      name: projectId === "default-project" ? "Default Project" : "Router Project",
      description: "Auto-created for direct router execution.",
    },
  });
}

export async function routerRouter(app: FastifyInstance) {
  app.post("/router/answer", async (req) => {
    const input = routerAnswerSchema.parse(req.body);

    if (!input.query?.trim()) {
      return { error: "query is required" };
    }

    const projectId = input.projectId ?? "default-project";
    await ensureRouterProject(projectId);

    return answerWithRouter({
      projectId,
      userId: input.userId,
      query: input.query,
      setupMessages: input.setupMessages,
    });
  });
}
