import fs from "node:fs/promises";
import path from "node:path";

const sourceRoot = path.resolve("agent(2)", "agent", "agent_core", "skills", "definitions");
const targetRoot = path.resolve("skills");

const files = await fs.readdir(sourceRoot).catch(() => []);
const jsonFiles = files.filter((file) => file.endsWith(".json")).sort();
const conversions = jsonFiles.map((file) => {
  const id = `agent-${file.replace(/\.json$/, "").replace(/_/g, "-")}`;
  return {
    source: path.join(sourceRoot, file),
    target: path.join(targetRoot, id, "skill.md"),
    metadata: path.join(targetRoot, id, "metadata.json")
  };
});

console.log(JSON.stringify({
  status: "dry-run",
  count: conversions.length,
  realLlmCalled: false,
  agentRuntimeCalled: false,
  realRepoWritePerformed: false,
  conversions
}, null, 2));
