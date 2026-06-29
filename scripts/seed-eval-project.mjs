import { prisma } from "../packages/database/src/prisma.js";

const projectId =
  process.env.EVAL_PROJECT_ID || "a26d90b1-dc27-43de-a1dd-5c961d54ca0e";

async function main() {
  const existing = await prisma.project.findUnique({ where: { id: projectId } });

  if (existing) {
    console.log(`Eval project already exists: ${projectId} (${existing.name})`);
    return;
  }

  await prisma.project.create({
    data: {
      id: projectId,
      name: "Scout Eval Project",
      description: "Auto-seeded eval project for CI and manual E2E testing",
    },
  });

  console.log(`Seeded eval project: ${projectId}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
