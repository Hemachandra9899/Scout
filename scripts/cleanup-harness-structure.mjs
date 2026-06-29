#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function exists(p) {
  return fs.existsSync(path.join(root, p));
}

function mkdirp(p) {
  fs.mkdirSync(path.join(root, p), { recursive: true });
}

function rmrf(p) {
  const full = path.join(root, p);
  if (fs.existsSync(full)) fs.rmSync(full, { recursive: true, force: true });
}

function moveIfExists(from, to) {
  const src = path.join(root, from);
  const dst = path.join(root, to);

  if (!fs.existsSync(src)) return false;

  mkdirp(path.dirname(to));
  if (fs.existsSync(dst)) {
    console.log(`skip move ${from} -> ${to}; destination exists`);
    return false;
  }

  fs.renameSync(src, dst);
  console.log(`moved ${from} -> ${to}`);
  return true;
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
}

function writeJson(p, value) {
  fs.writeFileSync(
    path.join(root, p),
    `${JSON.stringify(value, null, 2)}\n`,
  );
}

function replaceInFile(file, replacements) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) return;

  let text = fs.readFileSync(full, "utf8");
  const before = text;

  for (const [from, to] of replacements) {
    text = text.split(from).join(to);
  }

  if (text !== before) {
    fs.writeFileSync(full, text);
    console.log(`updated ${file}`);
  }
}

function walk(dir, out = []) {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) return out;

  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);

    if (
      rel.includes("node_modules") ||
      rel.includes(".git") ||
      rel.includes("dist") ||
      rel.includes(".next") ||
      rel.includes("harness-runs") ||
      rel.includes("harness-runs")
    ) {
      continue;
    }

    if (entry.isDirectory()) {
      walk(rel, out);
    } else {
      out.push(rel);
    }
  }

  return out;
}

function isTextFile(file) {
  return /\.(md|mdx|txt|json|js|mjs|ts|tsx|yml|yaml|sh)$/i.test(file);
}

function readUtf8(p) {
  const full = path.join(root, p);
  if (!fs.existsSync(full)) return null;
  return fs.readFileSync(full, "utf8");
}

function writeUtf8(p, content) {
  fs.writeFileSync(path.join(root, p), content, "utf8");
}

console.log("Cleaning Scout repo structure...");

// --- docs folder ---
mkdirp("docs");

// --- Merge lesson files into docs/LESSONS.md ---
const lessonsParts = [];

// Start with existing docs/LESSONS.md if present
const existingDocsLessons = readUtf8("docs/LESSONS.md");
if (existingDocsLessons) {
  lessonsParts.push(existingDocsLessons.trimEnd());
}

// Append root LESSONS.md content if it exists and is different
const rootLessons = readUtf8("LESSONS.md");
if (rootLessons && rootLessons.trim()) {
  // Only add if different from existing
  const normalized = rootLessons.trim();
  if (!existingDocsLessons || !existingDocsLessons.includes(normalized)) {
    lessonsParts.push("");  // spacer
    lessonsParts.push(normalized);
    console.log("merged LESSONS.md (root) into docs/LESSONS.md");
  }
}

// Append tasks/lessons.md content if it exists and is different
const tasksLessons = readUtf8("tasks/lessons.md");
if (tasksLessons && tasksLessons.trim()) {
  const normalized = tasksLessons.trim();
  if (!existingDocsLessons || !existingDocsLessons.includes(normalized)) {
    lessonsParts.push("");  // spacer
    lessonsParts.push(normalized);
    console.log("merged tasks/lessons.md into docs/LESSONS.md");
  }
}

if (lessonsParts.length > 0) {
  writeUtf8("docs/LESSONS.md", lessonsParts.join("\n") + "\n");
}

// Remove lesson file at root if it existed
if (rootLessons !== null) {
  fs.rmSync(path.join(root, "LESSONS.md"), { force: true });
  console.log("removed root LESSONS.md");
}

// --- Move benchmarks source folder to harness ---
if (exists("benchmarks") && !exists("harness")) {
  moveIfExists("benchmarks", "harness");
}

// --- Move old run output folder if present ---
if (exists("harness-runs") && !exists("harness-runs")) {
  moveIfExists("harness-runs", "harness-runs");
}

// --- Remove tasks folder ---
rmrf("tasks");

// --- Update package.json scripts ---
if (exists("package.json")) {
  const pkg = readJson("package.json");
  pkg.scripts = pkg.scripts || {};

  pkg.scripts["harness:research"] = "node harness/run-research-benchmark.mjs";
  pkg.scripts["harness:eval"] = "node harness/eval/run-eval.mjs";
  pkg.scripts["harness:ci"] =
    "EVAL_FAIL_UNDER=0.7 node harness/eval/run-eval.mjs";
  pkg.scripts["harness:analyze"] = "node harness/eval/analyze-run.mjs";

  // Backward-compatible aliases
  pkg.scripts["benchmark:research"] = "npm run harness:research";
  pkg.scripts["eval"] = "npm run harness:eval";
  pkg.scripts["eval:ci"] = "npm run harness:ci";
  pkg.scripts["eval:analyze"] = "npm run harness:analyze";

  writeJson("package.json", pkg);
  console.log("updated package.json scripts");
}

// --- Update run-eval defaults ---
replaceInFile("harness/eval/run-eval.mjs", [
  ['path.join("harness-runs",', 'path.join("harness-runs",'],
  ['process.env.EVAL_CASES_DIR || "harness/eval/cases"', 'process.env.EVAL_CASES_DIR || "harness/eval/cases"'],
]);

// --- Update .gitignore ---
replaceInFile(".gitignore", [
  ["# Scout benchmark outputs", "# Scout harness outputs"],
  ["harness-runs/", "harness-runs/"],
  ["!harness-runs/.gitkeep", "!harness-runs/.gitkeep"],
]);

// --- Global reference cleanup ---
const replacements = [
  ["harness/eval", "harness/eval"],
  ["harness/run-research-benchmark.mjs", "harness/run-research-benchmark.mjs"],
  ["harness-runs", "harness-runs"],
];

for (const file of walk(".")) {
  if (!isTextFile(file)) continue;
  replaceInFile(file, replacements);
}

console.log("Cleanup complete.");
