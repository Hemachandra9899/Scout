#!/usr/bin/env node
import { prisma } from "../packages/database/src/prisma.ts";

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
      { userId: null },
    ],
  },
});

console.log(`Deleted ${result.count} harness memory row(s).`);

const remaining = await prisma.memory.count({ where: { projectId } });
console.log(`Remaining memories for project: ${remaining}`);

await prisma.$disconnect();
