import fs from "node:fs/promises";
import path from "node:path";
import { prepareRunDirectory, relativeOutputDir } from "./runStore.js";

const agentRoot = path.resolve("agent(1)", "agent");
const pythonCoreRoot = path.join(agentRoot, "agent_core");
const contextServiceRoot = path.join(agentRoot, "context-service-handoff", "context-service-handoff");
const ignoredParts = new Set(["node_modules", "__pycache__", ".git", "dist", "coverage"]);
const agentRuns = new Map();

export async function inspectAgent1() {
  const files = await listAgentFiles();
  const entrypoints = files
    .filter((file) => [
      "agent/agent_core/main.py",
      "agent/agent_core/scripts/llm_smoke.py",
      "agent/context-service-handoff/context-service-handoff/code/backend/src/server.js",
      "agent/context-service-handoff/context-service-handoff/code/backend/package.json"
    ].includes(file.relativePath))
    .map((file) => file.relativePath);

  const dependencies = {
    python: files.some((file) => file.relativePath.endsWith(".py")),
    node: files.some((file) => file.relativePath.endsWith("package.json")),
    packageJson: files.filter((file) => file.relativePath.endsWith("package.json")).map((file) => file.relativePath),
    requirementsTxt: files.filter((file) => file.relativePath.endsWith("requirements.txt")).map((file) => file.relativePath),
    pyprojectToml: files.filter((file) => file.relativePath.endsWith("pyproject.toml")).map((file) => file.relativePath)
  };

  const riskScan = await scanAgentRisks(files);
  const inventory = {
    generatedAt: new Date().toISOString(),
    root: agentRoot,
    type: "mixed_python_agent_runtime_and_node_context_service",
    fileTreeSummary: summarizeFiles(files),
    entrypoints,
    dependencies,
    config: {
      env: [
        "AGENT_LLM_PROVIDER",
        "DOUBAO_API_KEY",
        "DOUBAO_ENDPOINT",
        "DOUBAO_BASE_URL",
        "AGENT_USE_LLM_PLANNER",
        "AGENT_USE_LLM_CODER",
        "AGENT_REPO_MODE",
        "AGENT_REPO_ROOT",
        "AGENT_REPO_APPLY",
        "AGENT_REPO_CONFIRM",
        "USE_CONTEXT_HTTP",
        "CONTEXT_SERVICE_URL"
      ],
      targetRepoPath: "TARGET_REPO_PATH is required by the workbench adapter; agent(1) uses AGENT_REPO_ROOT internally.",
      apiConfigPath: "API_CONFIG_PATH is used by the final program; agent(1) uses provider-specific env vars."
    },
    inputFormat: {
      pythonCli: "stdin text requirement",
      workbenchAdapter: "RequirementDSL/current planning task plus project metadata"
    },
    outputFormat: {
      pythonRuntime: "state JSON under agent_core/storage/states plus CLI summary",
      contextService: "HTTP JSON context/events/trace payloads",
      workbenchAdapter: "dry-run plan, review summary, PR draft, artifacts JSON"
    },
    invocation: {
      pythonCli: "python agent_core/main.py",
      contextService: "npm start from context-service-handoff/.../code/backend",
      workbench: "POST /api/agent/readiness and POST /api/agent/run"
    },
    safetyRisks: riskScan,
    reusableModules: [
      "agent_core/docs/* as contract documentation",
      "agent_core/interfaces/repo_adapter.py safety gates",
      "agent_core/storage/states/*.json as example artifacts",
      "context-service-handoff HTTP contract docs"
    ],
    doNotDirectlyIntegrate: [
      "node_modules",
      "__pycache__",
      "raw storage states as production state",
      "real_repo_apply mode",
      "AGENT_REPO_CONFIRM=YES path",
      "context-service backend as embedded source without dependency review"
    ],
    files
  };

  await writeInventoryReports(inventory);
  return inventory;
}

export async function getAgentReadiness(request = {}) {
  const inventory = await inspectAgent1();
  return {
    status: "ready",
    canRunDryRun: true,
    canRealWrite: false,
    requiresHumanConfirmationForRealWrite: true,
    agentType: inventory.type,
    entrypoints: inventory.entrypoints,
    protectedTargetRepo: request.targetRepoPath || process.env.TARGET_REPO_PATH || "not_set",
    boundaries: [
      "default dry-run only",
      "does not call real agent writer",
      "does not set AGENT_REPO_CONFIRM",
      "does not modify F:\\dsl",
      "does not touch hunter / auto-reply / A3B"
    ]
  };
}

export async function startAgentRun(request = {}, config = {}) {
  const dryRun = request.dryRun !== false;
  if (!dryRun) {
    return errorResult("agent_real_write_blocked", "Real agent writes require an explicit future confirmation path.");
  }

  const { runId, outputDir } = await prepareRunDirectory(config.runsRoot || path.resolve("runs"));
  const now = new Date().toISOString();
  const context = buildAgentContext(request, runId);
  const plan = buildPreviewPlan(context);
  const review = buildReviewCheck(plan, context);
  const prDraft = buildPrDraft(plan, review, context);
  const artifacts = {
    "agent_context.json": context,
    "agent_plan_preview.json": plan,
    "agent_review_check.json": review,
    "agent_pr_draft.json": prDraft
  };

  await fs.mkdir(outputDir, { recursive: true });
  await Promise.all(
    Object.entries(artifacts).map(([filename, json]) =>
      fs.writeFile(path.join(outputDir, filename), JSON.stringify(json, null, 2), "utf8")
    )
  );

  const run = {
    runId,
    status: "completed",
    startedAt: now,
    finishedAt: now,
    dryRun: true,
    realWritePerformed: false,
    outputDir,
    relativeOutputDir: relativeOutputDir(outputDir),
    latestReturn: "Dry-run plan generated from agent(1) contract; no target repo writes performed.",
    progress: [
      { step: "readiness", status: "completed" },
      { step: "context_preview", status: "completed" },
      { step: "plan_preview", status: "completed" },
      { step: "review_check", status: "needs_review" },
      { step: "pr_draft", status: "prepared" }
    ],
    context,
    plan,
    review,
    prDraft,
    artifacts: Object.fromEntries(Object.keys(artifacts).map((name) => [name, {
      exists: true,
      path: path.join(outputDir, name),
      json: artifacts[name]
    }]))
  };
  agentRuns.set(runId, run);
  return { ok: true, data: run, error: null };
}

export function getAgentRun(runId) {
  const run = agentRuns.get(runId);
  if (!run) return errorResult("agent_run_not_found", "Agent run not found", { runId });
  return { ok: true, data: run, error: null };
}

export function cancelAgentRun(runId) {
  const run = agentRuns.get(runId);
  if (!run) return errorResult("agent_run_not_found", "Agent run not found", { runId });
  if (run.status === "completed") return { ok: true, data: run, error: null };
  run.status = "cancelled";
  run.finishedAt = new Date().toISOString();
  return { ok: true, data: run, error: null };
}

export function getAgentArtifacts(runId) {
  const run = agentRuns.get(runId);
  if (!run) return errorResult("agent_run_not_found", "Agent run not found", { runId });
  return {
    ok: true,
    data: {
      runId,
      outputDir: run.outputDir,
      relativeOutputDir: run.relativeOutputDir,
      artifacts: run.artifacts,
      review: run.review,
      prDraft: run.prDraft
    },
    error: null
  };
}

function buildAgentContext(request, runId) {
  return {
    runId,
    projectId: request.projectId || "conduit-realworld-example-app",
    taskTitle: request.taskTitle || "Login failure guidance implementation",
    source: "design_planning_workbench",
    requirementDsl: request.requirementDsl || {
      title: "Login failure guidance",
      ready_for_agent: false,
      handoff_decision: "clarify_first"
    },
    targetRepoPath: request.targetRepoPath || process.env.TARGET_REPO_PATH || "not_set",
    executionBoundary: {
      dryRunDefault: true,
      realWriteDefault: false,
      agent1SourcePath: agentRoot,
      blockedModes: ["real_repo_apply", "AGENT_REPO_CONFIRM=YES"]
    }
  };
}

function buildPreviewPlan(context) {
  return {
    mode: "agent1_preview_adapter",
    taskName: context.taskTitle,
    executable: true,
    dryRun: true,
    steps: [
      { name: "Analyze RequirementDSL", owner: "planner_agent", output: "implementation intent and acceptance criteria" },
      { name: "Locate candidate files", owner: "locator_agent", output: "safe file list for human review" },
      { name: "Generate patch preview", owner: "coder_agent", output: "structured diff preview only" },
      { name: "Review patch", owner: "reviewer_agent", output: "risk and requirement mapping" },
      { name: "Verify preview", owner: "verifier_agent", output: "test command proposal, not shell execution" }
    ],
    targetFiles: [
      "src/components/LoginForm.jsx",
      "src/components/ErrorMessage.jsx",
      "src/App.test.jsx"
    ],
    safeguards: [
      "check target repo git status before any future real write",
      "require explicit confirmation before AGENT_REPO_CONFIRM=YES",
      "do not overwrite uncommitted user changes",
      "record written files and test results after future real write"
    ]
  };
}

function buildReviewCheck(plan, context) {
  return {
    status: "needs_review",
    summary: "Agent dry-run prepared an execution plan and candidate file list. Human review is required before any real write.",
    changedFiles: plan.targetFiles.map((file, index) => ({
      file,
      changeSummary: index === 0 ? "Add clearer login failure messaging states." : index === 1 ? "Normalize user-facing error copy." : "Add tests for visible failure guidance.",
      why: "Mapped to RequirementDSL acceptance criteria for login failure guidance.",
      risk: index === 2 ? "Test fixture may need existing app context." : "UI copy may diverge from backend failure codes.",
      requirementPoint: context.requirementDsl.title || "Login failure guidance"
    })),
    tests: [
      { command: "npm test", status: "planned" },
      { command: "npm run build", status: "planned" }
    ],
    manualConfirmations: [
      "Confirm backend error-code taxonomy.",
      "Confirm exact PM-owned copy for locked account and retry states.",
      "Confirm target repo is clean before real write."
    ]
  };
}

function buildPrDraft(plan, review, context) {
  return {
    title: "Improve login failure guidance",
    summary: [
      "Adds clearer user-facing login failure messaging.",
      "Keeps implementation behind a human-reviewed agent execution boundary.",
      "Includes tests planned for failure guidance visibility."
    ],
    changedFiles: review.changedFiles.map((item) => item.file),
    tests: review.tests,
    risks: review.changedFiles.map((item) => item.risk),
    checklist: [
      "Dry-run artifacts reviewed",
      "Target repo status checked",
      "No API keys or local configs committed",
      "Human confirmation collected before real write"
    ],
    sourceRun: context.runId
  };
}

async function listAgentFiles() {
  const root = path.resolve("agent(1)");
  const files = [];
  await walk(root, root, files);
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

async function walk(root, dir, files) {
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (ignoredParts.has(entry.name)) continue;
      await walk(root, full, files);
      continue;
    }
    const stat = await fs.stat(full);
    files.push({
      relativePath: path.relative(root, full).replaceAll("\\", "/"),
      length: stat.size,
      lastWriteTime: stat.mtime.toISOString()
    });
  }
}

function summarizeFiles(files) {
  const byExt = {};
  for (const file of files) {
    const ext = path.extname(file.relativePath).toLowerCase() || "(none)";
    byExt[ext] = (byExt[ext] || 0) + 1;
  }
  return {
    count: files.length,
    byExt,
    topLevel: [...new Set(files.map((file) => file.relativePath.split("/")[0]))]
  };
}

async function scanAgentRisks(files) {
  const patterns = [
    ["hardcodedExternalDslV2", /F:\\dsl-v2/i],
    ["apiKeyReference", /api[_-]?key|DOUBAO_API_KEY|OPENAI_API_KEY/i],
    ["bearerReference", /Authorization|Bearer/i],
    ["repoWrite", /apply_patch|real_repo_apply|AGENT_REPO_CONFIRM|write_text|open\(\"w\"/i],
    ["shellExecution", /subprocess|os\.system|run_command|spawn|exec\(/i],
    ["targetRepoAccess", /AGENT_REPO_ROOT|repo_root|TARGET_REPO/i]
  ];
  const findings = [];
  for (const file of files) {
    if (!/\.(py|js|json|md|txt|sh|ps1)$/i.test(file.relativePath)) continue;
    let text = "";
    try {
      text = await fs.readFile(path.resolve("agent(1)", file.relativePath), "utf8");
    } catch {
      continue;
    }
    for (const [name, pattern] of patterns) {
      if (pattern.test(text)) findings.push({ type: name, file: file.relativePath });
    }
  }
  return {
    canWriteFiles: findings.some((item) => item.type === "repoWrite"),
    canExecuteShell: findings.some((item) => item.type === "shellExecution"),
    canAccessTargetRepo: findings.some((item) => item.type === "targetRepoAccess"),
    dependsOnExternalDslV2: findings.some((item) => item.type === "hardcodedExternalDslV2"),
    dependsOnApiKey: findings.some((item) => item.type === "apiKeyReference"),
    findings
  };
}

async function writeInventoryReports(inventory) {
  const reportingDir = path.resolve("reporting");
  await fs.mkdir(reportingDir, { recursive: true });
  await fs.writeFile(path.join(reportingDir, "agent1_inventory.json"), JSON.stringify({
    ...inventory,
    files: inventory.files.slice(0, 500)
  }, null, 2), "utf8");
  const md = [
    "## Agent(1) Inventory",
    "",
    `- type: ${inventory.type}`,
    `- root: ${inventory.root}`,
    `- file count: ${inventory.fileTreeSummary.count}`,
    `- entrypoints: ${inventory.entrypoints.join(", ") || "none"}`,
    `- dependencies: python=${inventory.dependencies.python}, node=${inventory.dependencies.node}`,
    `- config env: ${inventory.config.env.join(", ")}`,
    `- input: ${inventory.inputFormat.pythonCli}; workbench=${inventory.inputFormat.workbenchAdapter}`,
    `- output: ${inventory.outputFormat.workbenchAdapter}`,
    `- invocation: ${inventory.invocation.pythonCli}`,
    "",
    "### Safety Risks",
    `- can write files: ${inventory.safetyRisks.canWriteFiles}`,
    `- can execute shell: ${inventory.safetyRisks.canExecuteShell}`,
    `- can access target repo: ${inventory.safetyRisks.canAccessTargetRepo}`,
    `- depends on F:\\dsl-v2: ${inventory.safetyRisks.dependsOnExternalDslV2}`,
    `- depends on API key env: ${inventory.safetyRisks.dependsOnApiKey}`,
    "",
    "### Reusable Modules",
    ...inventory.reusableModules.map((item) => `- ${item}`),
    "",
    "### Do Not Directly Integrate",
    ...inventory.doNotDirectlyIntegrate.map((item) => `- ${item}`)
  ].join("\n");
  await fs.writeFile(path.join(reportingDir, "agent1_inventory.md"), md, "utf8");
}

function errorResult(code, message, details = {}) {
  return {
    ok: false,
    data: null,
    error: { code, message, details }
  };
}
