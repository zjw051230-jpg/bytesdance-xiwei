import fs from "node:fs/promises";
import path from "node:path";

export const defaultRunsRoot = path.resolve("runs");

export function createRunId(date = new Date()) {
  const stamp = date.toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
  const suffix = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `RUN-${stamp}-${suffix}`;
}

export async function prepareRunDirectory(runsRoot = defaultRunsRoot, runId = createRunId()) {
  const outputDir = path.resolve(runsRoot, runId);
  await fs.mkdir(outputDir, { recursive: true });
  return { runId, outputDir };
}

export function relativeOutputDir(outputDir) {
  const relative = path.relative(process.cwd(), outputDir);
  return relative || outputDir;
}
