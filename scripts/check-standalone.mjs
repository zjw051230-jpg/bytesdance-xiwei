import fs from "node:fs/promises";
import path from "node:path";

const requiredFiles = [
  "configs/api_config.template.json",
  "e2e/runner/standalone-e2e.mjs",
  "e2e/runner/config-loader.mjs",
  "e2e/runner/llm-client.mjs",
  "e2e/runner/json-utils.mjs",
  "e2e/runner/secret-scan.mjs",
  "e2e/prompts/pm_to_requirement_dsl.md",
  "e2e/prompts/context_readiness.md",
  "e2e/prompts/agent_codegen.md",
  "e2e/prompts/skills/prd_to_dsl/skill.md",
  "e2e/prompts/skills/clarification/skill.md",
  "e2e/prompts/skills/code_context/skill.md",
  "e2e/schemas/requirement_dsl.schema.json",
  "e2e/schemas/context_readiness.schema.json",
  "e2e/schemas/agent_output.schema.json",
  "e2e/context/default_code_context_packet.json",
  "e2e/context/context-adapter.mjs",
  "e2e/agent/agent-runner.mjs",
  "scripts/smoke-e2e-real.mjs"
];

const requiredScripts = [
  "check:standalone",
  "smoke:e2e-real",
  "smoke:e2e-real:dry-run"
];

const requiredGitignoreRules = [
  ".env",
  ".env.*",
  "*.local.json",
  "configs/api_config.local.json",
  "configs/doubao_api_config.local.json",
  "runs/",
  "outputs/",
  "node_modules/",
  "dist/",
  "frontend/dist/",
  "coverage/",
  ".cache/",
  "*.log"
];

const result = {
  status: "passed",
  requiresExternalDslV2: false,
  missingFiles: [],
  missingScripts: [],
  missingGitignoreRules: [],
  localConfigIgnored: false,
  notes: []
};

for (const file of requiredFiles) {
  if (!(await exists(path.resolve(file)))) result.missingFiles.push(file);
}

const packageJson = JSON.parse(await fs.readFile("package.json", "utf8"));
for (const script of requiredScripts) {
  if (!packageJson.scripts?.[script]) result.missingScripts.push(script);
}

const gitignore = await fs.readFile(".gitignore", "utf8");
for (const rule of requiredGitignoreRules) {
  if (!gitignore.split(/\r?\n/).includes(rule)) result.missingGitignoreRules.push(rule);
}
result.localConfigIgnored = gitignore.split(/\r?\n/).includes("configs/api_config.local.json") &&
  gitignore.split(/\r?\n/).includes("*.local.json");

const sourceFiles = await listTextFiles(["server", "src", "scripts", "e2e", "configs", "docs"]);
const hardcodedExternalRefs = [];
for (const file of sourceFiles) {
  const text = await fs.readFile(file, "utf8");
  if (text.includes("F:\\dsl-v2")) {
    hardcodedExternalRefs.push(file);
  }
}
result.externalDslV2References = hardcodedExternalRefs;
result.requiresExternalDslV2 = false;

if (result.missingFiles.length || result.missingScripts.length || result.missingGitignoreRules.length || !result.localConfigIgnored) {
  result.status = "failed";
}

console.log(JSON.stringify(result, null, 2));
if (result.status !== "passed") process.exit(1);

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function listTextFiles(roots) {
  const files = [];
  for (const root of roots) {
    if (!(await exists(root))) continue;
    await walk(root, files);
  }
  return files.filter((file) => !file.endsWith(".png") && !file.endsWith(".jpg"));
}

async function walk(dir, files) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", "dist", "runs", "coverage", ".git"].includes(entry.name)) continue;
      await walk(full, files);
    } else {
      files.push(full);
    }
  }
}
