import fs from "node:fs/promises";
import path from "node:path";

const runDir = process.argv[2];

if (!runDir) {
  console.error("Usage: node benchmarks/eval/analyze-run.mjs <benchmark-runs/run-dir>");
  process.exit(1);
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function formatMs(ms) {
  if (!Number.isFinite(Number(ms))) return "n/a";
  const value = Number(ms);
  if (value < 1000) return `${value}ms`;
  return `${(value / 1000).toFixed(1)}s`;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function main() {
  const evalPath = path.join(runDir, "eval.json");
  const evalData = await readJson(evalPath);
  const rows = safeArray(evalData.rows ?? evalData.results);

  const files = await fs.readdir(runDir);
  const trajectoryFiles = files.filter((file) => file.endsWith(".trajectory.json"));

  const trajectories = [];
  for (const file of trajectoryFiles) {
    try {
      trajectories.push(await readJson(path.join(runDir, file)));
    } catch {
      // ignore malformed
    }
  }

  const byId = new Map(trajectories.map((item) => [item.caseId, item]));

  const failed = rows.filter((row) => !row.passed);
  const byReward = [...rows].sort(
    (a, b) => Number(a.reward ?? 0) - Number(b.reward ?? 0),
  );

  const toolCounts = {};
  const failureTools = {};

  for (const row of rows) {
    const tool = row.actualTool ?? row.tool ?? row.routedTool ?? "unknown";
    toolCounts[tool] = (toolCounts[tool] ?? 0) + 1;
    if (!row.passed) failureTools[tool] = (failureTools[tool] ?? 0) + 1;
  }

  const lines = [];
  lines.push("# Harness Run Analysis");
  lines.push("");
  lines.push(`Run: \`${runDir}\``);
  lines.push("");
  lines.push(`Total cases: ${rows.length}`);
  lines.push(`Passed: ${rows.filter((row) => row.passed).length}/${rows.length}`);
  lines.push(
    `Mean reward: ${
      Number(evalData.aggregate?.meanReward ?? evalData.meanReward ?? 0).toFixed(2)
    }`,
  );
  lines.push("");

  lines.push("## Tool counts");
  lines.push("");
  for (const [tool, count] of Object.entries(toolCounts)) {
    lines.push(`- ${tool}: ${count}`);
  }
  lines.push("");

  if (Object.keys(failureTools).length > 0) {
    lines.push("## Failure tools");
    lines.push("");
    for (const [tool, count] of Object.entries(failureTools)) {
      lines.push(`- ${tool}: ${count}`);
    }
    lines.push("");
  }

  lines.push("## Lowest reward cases");
  lines.push("");
  for (const row of byReward.slice(0, Math.min(10, byReward.length))) {
    lines.push(
      `- ${row.id}: reward=${row.reward ?? "n/a"}, passed=${row.passed}, tool=${row.actualTool ?? row.expectedTool ?? "unknown"}`,
    );
    if (row.failures) lines.push(`  - failures: ${row.failures}`);
    if (Array.isArray(row.rewardReasons)) {
      lines.push(`  - rewardReasons: ${row.rewardReasons.join("; ")}`);
    }

    const trajectory = byId.get(row.id);
    const toolEvent = safeArray(trajectory?.trajectory).find(
      (event) => event.type === "tool_result",
    );
    const criticEvent = safeArray(trajectory?.trajectory).find(
      (event) => event.type === "critic_verdict",
    );

    if (criticEvent) {
      lines.push(
        `  - critic: verdict=${criticEvent.verdict}, score=${criticEvent.score}, relevance=${criticEvent.relevanceRatio}, supported=${criticEvent.supportedRatio}`,
      );

      if (safeArray(criticEvent.missingAnchors).length > 0) {
        lines.push(`  - missingAnchors: ${criticEvent.missingAnchors.join(", ")}`);
      }
      if (safeArray(criticEvent.unsupportedClaims).length > 0) {
        lines.push(`  - unsupportedClaims: ${criticEvent.unsupportedClaims.join("; ")}`);
      }
    }

    const trace = safeArray(toolEvent?.researchTrace);
    if (trace.length > 0) {
      lines.push("  - researchTrace:");
      for (const stage of trace) {
        lines.push(
          `    - ${stage.name ?? stage.stage ?? "?"}: ${formatMs(stage.ms ?? stage.durationMs)} ${stage.ok ?? stage.success ? "ok" : "failed"}${stage.error ? ` — ${stage.error}` : ""}`,
        );
      }
    }
  }

  if (rows.length > 10) {
    lines.push("");
    lines.push("## All cases by reward");
    lines.push("");
    lines.push("| Case | Reward | Passed | Tool | Latency | Failures |");
    lines.push("| --- | ---: | --- | --- | ---: | --- |");
    for (const row of byReward) {
      lines.push(
        `| ${row.id} | ${row.reward ?? ""} | ${row.passed ? "✅" : "❌"} | ${row.actualTool ?? "?"} | ${formatMs(row.durationMs)} | ${row.failures || ""} |`,
      );
    }
  }

  const outputPath = path.join(runDir, "analysis.md");
  await fs.writeFile(outputPath, `${lines.join("\n")}\n`);

  console.log(lines.join("\n"));
  console.log("");
  console.log(`Wrote ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
