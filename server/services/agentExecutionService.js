import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { prepareRunDirectory, relativeOutputDir } from "./runStore.js";
import { persistAgentDryRun, withPersistence } from "./persistence/workbenchPersistenceAdapter.js";
import { buildAgentStageEvents, createAgent2DryRun, mapAgent2ResultToWorkbench } from "./agent2Adapter.js";
import { readDoubaoArkConfig } from "./doubaoArkClient.js";
import { selectWorkspaceAdapter } from "./workspaceAdapter.js";

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
    canRealWrite: Boolean(request.targetRepoPath || process.env.TARGET_REPO_PATH),
    requiresHumanConfirmationForRealWrite: true,
    agentType: inventory.type,
    entrypoints: inventory.entrypoints,
    protectedTargetRepo: request.targetRepoPath || process.env.TARGET_REPO_PATH || "not_set",
    boundaries: [
      "default workbench action starts real Agent(2) only when targetRepoPath is provided",
      "real execution sets AGENT_REPO_MODE=real, AGENT_REPO_APPLY=1, AGENT_REPO_CONFIRM=YES",
      "agent review/validation may still block writes",
      "dry-run agent execution is enabled for planning timeline previews",
      "target repo path is provided by the selected project localPath"
    ]
  };
}

export async function startAgentRun(request = {}, config = {}) {
  const dryRun = request.dryRun === true;
  const { runId, outputDir } = await prepareRunDirectory(config.runsRoot || path.resolve("runs"));
  const now = new Date().toISOString();

  if (!dryRun) {
    const targetRepoPath = request.targetRepoPath || request.localPath || process.env.TARGET_REPO_PATH || "";
    if (!targetRepoPath) {
      return errorResult("agent_target_repo_missing", "Real agent execution requires selected project localPath/targetRepoPath.");
    }
    const targetStat = await fs.stat(targetRepoPath).catch(() => null);
    if (!targetStat?.isDirectory?.()) {
      return errorResult("agent_target_repo_invalid", "Real agent execution targetRepoPath must be an existing directory.", {
        targetRepoPath
      });
    }
    if (selectedAgentProvider(request, config) !== "agent2") {
      request = { ...request, agentProvider: "agent2" };
    }
    let workspace;
    try {
      const adapter = config.workspaceAdapter || await selectWorkspaceAdapter({
        sourceRepoPath: targetRepoPath,
        runsRoot: config.runsRoot || path.resolve("runs"),
        adapterType: config.workspaceAdapterType
      });
      workspace = await adapter.createRunWorkspace({
        runId,
        sourceRepoPath: targetRepoPath
      });
    } catch (error) {
      return errorResult(error.code || "workspace_create_failed", "Could not create isolated run workspace.", {
        reason: String(error.message || error),
        sourceRepoPath: targetRepoPath
      });
    }

    const result = await runAgent2RealExecution(request, {
      runId,
      outputDir,
      relativeOutputDir: relativeOutputDir(outputDir),
      targetRepoPath: workspace.workspacePath,
      sourceRepoPath: targetRepoPath,
      workspace,
      now
    }, config);
    if (!result.ok) return result;
    await attachWorkspaceChanges(result.data, workspace, config);
    agentRuns.set(runId, result.data);
    persistAgentDryRun(result.data, config);
    return result;
  }

  if (selectedAgentProvider(request, config) === "agent2") {
    const run = createAgent2DryRun(request, {
      runId,
      outputDir,
      relativeOutputDir: relativeOutputDir(outputDir),
      now
    });
    await writeWorkbenchArtifacts(outputDir, run.artifacts);
    agentRuns.set(runId, run);
    persistAgentDryRun(run, config);
    return { ok: true, data: run, error: null };
  }

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
  const stageEvents = buildAgentStageEvents({
    runId,
    status: "completed",
    startedAt: now,
    finishedAt: now,
    dryRun: true,
    realWritePerformed: false,
    context,
    plan,
    review,
    prDraft,
    artifacts,
    latestReturn: "Dry-run plan generated from agent(1) contract; no target repo writes performed."
  });
  plan.stageEvents = Array.isArray(stageEvents) ? stageEvents : [];
  plan.activityTimeline = plan.stageEvents;
  artifacts["agent_activity_timeline.json"] = {
    runId,
    stageEvents: plan.stageEvents,
    dryRun: true,
    realWritePerformed: false
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
    stageEvents: plan.stageEvents,
    activityTimeline: plan.stageEvents,
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
  persistAgentDryRun(run, config);
  return { ok: true, data: run, error: null };
}

async function runAgent2RealExecution(request = {}, options = {}, config = {}) {
  const agent2Root = path.resolve("agent(2)", "agent");
  const mainModuleCwd = agent2Root;
  const targetRepoPath = options.targetRepoPath;
  const sourceRepoPath = options.sourceRepoPath || targetRepoPath;
  const inputDsl = buildAgent2RequirementDsl(request, targetRepoPath);
  const inputJson = JSON.stringify(inputDsl);
  const rawOutputPath = path.join(options.outputDir, "agent2_real_stdout.json");
  const stderrPath = path.join(options.outputDir, "agent2_real_stderr.log");
  const stderrIndexPath = path.join(options.outputDir, "agent2_real_stderr.json");
  const requestPath = path.join(options.outputDir, "agent2_real_request.json");

  await fs.mkdir(options.outputDir, { recursive: true });
  await fs.writeFile(requestPath, JSON.stringify(inputDsl, null, 2), "utf8");

  const env = {
    ...process.env,
    AGENT_OUTPUT_JSON: "1",
    AGENT_REPO_MODE: "real",
    AGENT_REPO_ROOT: targetRepoPath,
    AGENT_REPO_APPLY: "1",
    AGENT_REPO_CONFIRM: "YES",
    AGENT_PROVIDER: "agent2",
    AGENT_USE_LLM_PLANNER: "1",
    AGENT_USE_LLM_CODER: "1",
    AGENT_TASK_ID: options.runId,
    AGENT_STATE_DIR: path.join(options.outputDir, "agent2_state"),
    PYTHONIOENCODING: "utf-8"
  };
  if (request.runTests === true) {
    env.AGENT_TEST_RUN = "1";
    env.AGENT_TEST_CONFIRM = "YES";
  }
  try {
    await attachDoubaoEnv(env, config);
  } catch (error) {
    return errorResult("doubao_config_missing", "Doubao Ark API config could not be read.", {
      reason: String(error.message || error)
    });
  }

  const pythonCommand = config.pythonCommand || process.env.PYTHON || "python";
  const startedAt = Date.now();
  const childOptions = {
    cwd: mainModuleCwd,
    env,
    input: inputJson,
    spawnImpl: config.spawnImpl,
    timeoutMs: Number(config.agentRealRunTimeoutMs || process.env.AGENT_REAL_RUN_TIMEOUT_MS || 180_000)
  };
  const childResult = typeof config.agent2Runner === "function"
    ? await config.agent2Runner({ command: pythonCommand, args: ["-m", "agent_core.main"], ...childOptions })
    : await spawnWithInput(pythonCommand, ["-m", "agent_core.main"], childOptions);
  await fs.writeFile(rawOutputPath, childResult.stdout || "", "utf8");
  await fs.writeFile(stderrPath, childResult.stderr || "", "utf8");

  if (childResult.timedOut) {
    return errorResult("agent2_timeout", "Agent(2) real execution timed out.", {
      runId: options.runId,
      stderrPath,
      rawOutputPath
    });
  }

  if (childResult.exitCode !== 0) {
    return errorResult("agent2_process_failed", "Agent(2) real execution process failed.", {
      runId: options.runId,
      exitCode: childResult.exitCode,
      stderrPath,
      rawOutputPath
    });
  }

  let agent2Result;
  try {
    agent2Result = parseJsonFromStdout(childResult.stdout);
  } catch (error) {
    return errorResult("agent2_invalid_json", "Agent(2) real execution did not return valid JSON.", {
      runId: options.runId,
      exitCode: childResult.exitCode,
      stderrPath,
      rawOutputPath,
      reason: String(error.message || error)
    });
  }

  const run = mapAgent2ResultToWorkbench(agent2Result, {
    ...request,
    runId: options.runId,
    outputDir: options.outputDir,
    relativeOutputDir: options.relativeOutputDir,
    now: options.now,
    dryRun: false,
    realExecution: true,
    targetRepoPath,
    requirementDsl: inputDsl
  });
  run.startedAt = new Date(startedAt).toISOString();
  run.finishedAt = new Date().toISOString();
  run.agentProcess = {
    command: pythonCommand,
    args: ["-m", "agent_core.main"],
    cwd: mainModuleCwd,
    exitCode: childResult.exitCode,
    timedOut: childResult.timedOut,
    stderrPath,
    rawOutputPath,
    requestPath
  };
  run.workspace = {
    ...(options.workspace || {}),
    baselineSnapshotId: `snapshot-${options.runId}-baseline`
  };
  run.sourceRepoPath = sourceRepoPath;
  run.targetRepoPath = targetRepoPath;
  run.verificationStatus = "fresh";
  run.context = {
    ...(run.context || {}),
    sourceRepoPath,
    targetRepoPath,
    workspacePath: targetRepoPath,
    baselineSnapshotId: run.workspace.baselineSnapshotId,
    executionBoundary: {
      ...(run.context?.executionBoundary || {}),
      sourceRepoPath,
      isolatedWorkspacePath: targetRepoPath,
      originalRepoWriteBlocked: true
    }
  };
  run.artifacts = {
    ...run.artifacts,
    "agent2_real_request.json": { exists: true, path: requestPath, json: inputDsl },
    "agent2_real_stdout.json": { exists: true, path: rawOutputPath, json: agent2Result },
    "agent2_real_stderr.json": { exists: true, path: stderrIndexPath, json: { path: stderrPath } }
  };

  await writeWorkbenchArtifacts(options.outputDir, run.artifacts);
  return { ok: true, data: run, error: null };
}

async function attachWorkspaceChanges(run, workspace, config = {}) {
  if (!workspace?.workspacePath || !workspace?.baselinePath) return;
  try {
    const adapter = config.workspaceAdapter || await selectWorkspaceAdapter({
      sourceRepoPath: workspace.sourceRepoPath,
      runsRoot: config.runsRoot || path.resolve("runs"),
      adapterType: workspace.adapterType || config.workspaceAdapterType || "copy"
    });
    const changes = await adapter.getChangedFiles({
      workspacePath: workspace.workspacePath,
      baselinePath: workspace.baselinePath
    });
    run.workspace = {
      ...(run.workspace || workspace),
      ...workspace,
      baselineSnapshotId: run.workspace?.baselineSnapshotId || `snapshot-${run.runId}-baseline`,
      changedFiles: changes
    };
    if (Array.isArray(run.review?.changedFiles)) {
      const summaryByFile = new Map(run.review.changedFiles.map((file) => [file.file || file.filePath, file]));
      run.workspace.changedFiles = changes.map((change) => ({
        ...change,
        changeSummary: summaryByFile.get(change.filePath)?.changeSummary || summaryByFile.get(change.filePath)?.summary || `${change.changeType} ${change.filePath}`
      }));
    }
  } catch (error) {
    run.workspace = {
      ...(run.workspace || workspace),
      ...workspace,
      baselineSnapshotId: run.workspace?.baselineSnapshotId || `snapshot-${run.runId}-baseline`,
      changeScanError: String(error.message || error)
    };
  }
}

function buildAgent2RequirementDsl(request = {}, targetRepoPath = "") {
  const source = request.requirementDsl && typeof request.requirementDsl === "object" ? request.requirementDsl : {};
  const taskTitle = request.taskTitle || source.task_name || source.title || source.user_story || "Workbench real agent execution";
  const themeRequest = isThemeRequest(`${taskTitle} ${source.user_story || ""} ${source.rawPmInput || ""} ${source.description || ""}`);
  const sourceTargetModules = source.target_modules || source.targetModules || source.targetFiles || source.target_files;
  const targetModules = themeRequest
    ? ["frontend/src/styles.css", "frontend/src/index.css", "frontend/src/App.jsx", ...arrayOfStrings(sourceTargetModules)]
    : sourceTargetModules || ["frontend/src"];
  const acceptanceCriteria = source.acceptance_criteria || source.acceptanceCriteria || source.acceptance || [taskTitle];
  const constraints = [
    ...arrayOfStrings(source.constraints),
    "Apply real repository changes requested by this Workbench run.",
    "Do not modify secrets or local configuration files."
  ];
  return {
    requirement_id: request.requirementId || source.requirement_id || source.id || `req-${request.projectId || "workbench"}`,
    task_name: taskTitle,
    user_story: source.user_story || source.rawPmInput || source.description || taskTitle,
    requirement_type: themeRequest ? "theme" : source.requirement_type || source.requirementType || "conduit_l1_frontend",
    target_repo: targetRepoPath,
    target_modules: [...new Set(arrayOfStrings(targetModules).length ? arrayOfStrings(targetModules) : ["frontend/src"])],
    target_files: themeRequest ? ["frontend/src/styles.css", "frontend/src/index.css", "frontend/src/App.jsx"] : arrayOfStrings(source.target_files || source.targetFiles),
    acceptance_criteria: arrayOfStrings(acceptanceCriteria).length ? arrayOfStrings(acceptanceCriteria) : [taskTitle],
    constraints,
    skill_hint: themeRequest ? "conduit-theme" : source.skill_hint || source.skillHint || "",
    test_commands: arrayOfStrings(source.test_commands || source.testCommands),
    risk_level: ["low", "medium", "high"].includes(source.risk_level || source.riskLevel) ? (source.risk_level || source.riskLevel) : "low"
  };
}

function arrayOfStrings(value) {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function isThemeRequest(text) {
  return /配色|主题|样式|黑红|暗色|深色|颜色|界面|ui|theme|style|css|palette|dark|red|black/i.test(String(text || ""));
}

async function attachDoubaoEnv(env, config = {}) {
  const doubaoConfig = await readDoubaoArkConfig(config);
  env.AGENT_LLM_PROVIDER = "doubao";
  env.DOUBAO_API_KEY = doubaoConfig.apiKey;
  env.DOUBAO_ENDPOINT = doubaoConfig.model || doubaoConfig.endpointId;
  env.DOUBAO_BASE_URL = doubaoConfig.baseURL;
}

function spawnWithInput(command, args, options = {}) {
  return new Promise((resolve) => {
    const spawnImpl = options.spawnImpl || spawn;
    const child = spawnImpl(command, args, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = options.timeoutMs > 0 ? setTimeout(() => {
      if (settled) return;
      child.kill();
      settled = true;
      resolve({ exitCode: null, stdout, stderr, timedOut: true });
    }, options.timeoutMs) : null;
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ exitCode: null, stdout, stderr: `${stderr}\n${String(error.message || error)}`, timedOut: false });
    });
    child.on("close", (exitCode) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ exitCode, stdout, stderr, timedOut: false });
    });
    child.stdin.end(options.input || "");
  });
}

function parseJsonFromStdout(stdout = "") {
  const text = String(stdout || "").trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new Error("no JSON object found in stdout");
  }
}

export function getAgentRun(runId, config = {}) {
  const persisted = readPersistedAgentRun(runId, config);
  if (persisted?.error) return persisted.error;
  if (persisted?.run) {
    const memoryRun = agentRuns.get(runId);
    return { ok: true, data: mergeAgentRun(memoryRun, persisted.run), error: null };
  }
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

export function getAgentArtifacts(runId, config = {}) {
  const persisted = readPersistedAgentArtifacts(runId, config);
  if (persisted?.error) return persisted.error;
  if (persisted?.run) return { ok: true, data: persisted, error: null };

  const run = agentRuns.get(runId);
  if (!run) return errorResult("agent_run_not_found", "Agent run not found", { runId });
  return {
    ok: true,
    data: {
      runId,
      outputDir: run.outputDir,
      relativeOutputDir: run.relativeOutputDir,
      artifacts: run.artifacts,
      stageEvents: coalesceStageEvents(run.stageEvents, run.activityTimeline),
      activityTimeline: coalesceStageEvents(run.activityTimeline, run.stageEvents),
      review: run.review,
      prDraft: run.prDraft
    },
    error: null
  };
}

function readPersistedAgentRun(runId, config = {}) {
  try {
    return withPersistence(config, (service) => ({ run: service.agentRuns.get(runId) }));
  } catch (error) {
    return { error: errorResult("db_error", "Database request failed", dbErrorDetails(error)) };
  }
}

function readPersistedAgentArtifacts(runId, config = {}) {
  try {
    return withPersistence(config, (service) => {
      const run = service.agentRuns.get(runId);
      if (!run) return {};
      const artifactList = service.agentArtifacts.list(runId);
      const reviewItems = service.reviewItems.listByRun(runId);
      const prDraft = run.requirementId ? service.prDrafts.getByRequirement(run.requirementId) : null;
      const activity = service.activity.listByRun(runId);
      return {
        run,
        runId,
        artifactList,
        artifacts: Object.fromEntries(artifactList.map((artifact) => [artifact.name, {
          id: artifact.id,
          exists: true,
          type: artifact.type,
          path: artifact.path,
          summary: artifact.summary,
          createdAt: artifact.createdAt
        }])),
        review: reviewFromItems(reviewItems, run),
        prDraft: prDraft ? prDraftForWorkbench(prDraft) : null,
        stageEvents: coalesceStageEvents(run.planJson?.stageEvents, run.planJson?.activityTimeline),
        activityTimeline: coalesceStageEvents(run.planJson?.activityTimeline, run.planJson?.stageEvents),
        activity
      };
    });
  } catch (error) {
    return { error: errorResult("db_error", "Database request failed", dbErrorDetails(error)) };
  }
}

function mergeAgentRun(memoryRun, persistedRun) {
  const plan = memoryRun?.plan || persistedRun.planJson || {};
  const stageEvents = coalesceStageEvents(memoryRun?.stageEvents, memoryRun?.activityTimeline, plan.stageEvents, plan.activityTimeline);
  return {
    ...(memoryRun || {}),
    ...persistedRun,
    id: persistedRun.id,
    runId: persistedRun.runId || persistedRun.id,
    latestReturn: persistedRun.resultSummary || memoryRun?.latestReturn || "",
    context: memoryRun?.context || persistedRun.contextSnapshot || {},
    plan,
    stageEvents,
    activityTimeline: coalesceStageEvents(memoryRun?.activityTimeline, stageEvents),
    progress: memoryRun?.progress || []
  };
}

export function getAgentRunEvents(runId, config = {}) {
  const result = getAgentRun(runId, config);
  if (!result.ok) return result;
  const stageEvents = coalesceStageEvents(result.data.stageEvents, result.data.activityTimeline);
  return {
    ok: true,
    data: {
      runId,
      stageEvents,
      activityTimeline: coalesceStageEvents(result.data.activityTimeline, stageEvents),
      dryRun: result.data.dryRun ?? true,
      realWritePerformed: result.data.realWritePerformed ?? false
    },
    error: null
  };
}

function coalesceStageEvents(...values) {
  return values.find((value) => Array.isArray(value)) || [];
}

function reviewFromItems(reviewItems = [], run = {}) {
  return {
    status: reviewItems.length ? "needs_review" : "empty",
    summary: run.resultSummary || "Persisted agent review items.",
    changedFiles: reviewItems.map((item) => ({
      file: item.filePath,
      changeSummary: item.changeSummary,
      why: item.reason,
      requirementPoint: item.requirementMapping,
      risk: item.riskLevel,
      humanStatus: item.humanStatus,
      humanComment: item.humanComment
    })),
    tests: [],
    manualConfirmations: []
  };
}

function prDraftForWorkbench(prDraft) {
  return {
    ...prDraft,
    summary: prDraft.summary ? prDraft.summary.split("\n").filter(Boolean) : [],
    checklist: prDraft.checklistJson || [],
    changedFiles: [],
    tests: [],
    risks: [],
    sourceRun: prDraft.runId
  };
}

function dbErrorDetails(error) {
  return {
    name: String(error?.name || "Error"),
    code: String(error?.code || "")
  };
}

function selectedAgentProvider(request = {}, config = {}) {
  return String(request.agentProvider || config.agentProvider || process.env.AGENT_PROVIDER || "agent1").toLowerCase();
}

async function writeWorkbenchArtifacts(outputDir, artifacts = {}) {
  await fs.mkdir(outputDir, { recursive: true });
  await Promise.all(
    Object.entries(artifacts).map(([filename, artifact]) =>
      fs.writeFile(path.join(outputDir, filename), JSON.stringify(artifact.json ?? artifact, null, 2), "utf8")
    )
  );
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
