#!/usr/bin/env node
import { prisma } from "@rlm-forge/database/prisma.js";

const projectId = process.env.EVAL_PROJECT_ID;

if (!projectId) {
  console.error("Set EVAL_PROJECT_ID");
  process.exit(1);
}

const result = await prisma.memory.deleteMany({
  where: {
    projectId,
    OR: [
      { userId: { contains: "harness" } },
      { userId: { contains: "phase2" } },
      { userId: { contains: "eval" } },
    ],
  },
});

console.log(`Deleted ${result.count} harness memory row(s).`);

await prisma.$disconnect();
