import type { FastifyInstance } from "fastify";
import {
  conversationParamsSchema,
  createConversationSchema,
  listConversationParamsSchema,
} from "./conversations.schema.js";
import {
  createConversation,
  getConversation,
  listProjectConversations,
} from "./conversations.service.js";

export async function conversationsRouter(app: FastifyInstance) {
  app.get("/projects/:projectId/conversations", async (req) => {
    const params = listConversationParamsSchema.parse(req.params);
    return listProjectConversations(params.projectId);
  });

  app.post("/conversations", async (req) => {
    const input = createConversationSchema.parse(req.body);
    return createConversation(input);
  });

  app.get("/conversations/:id", async (req) => {
    const params = conversationParamsSchema.parse(req.params);
    return getConversation(params.id);
  });
}
