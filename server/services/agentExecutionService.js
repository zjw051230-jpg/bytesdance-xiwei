import fs from "node:fs/promises";
import path from "node:path";
import { prepareRunDirectory, relativeOutputDir } from "./runStore.js";
import { persistAgentDryRun, withPersistence } from "./persistence/workbenchPersistenceAdapter.js";
import { buildAgentStageEvents, createAgent2DryRun, mapAgent2ResultToWorkbench, runRealAgent2 } from "./agent2Adapter.js";
import { readDoubaoArkConfig } from "./doubaoArkClient.js";
import { getChangedFilesFromSnapshot } from "./workspaceAdapter.js";

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
    const validation = await validateRealAgentRequest(request, config);
    if (!validation.ok) return errorResult(validation.code, validation.message, validation.details);
    const workspace = await createDirectTargetBaseline({
      runId,
      repoPath: validation.repoPath,
      runsRoot: config.runsRoot || path.resolve("runs")
    });
    const result = await runAgent2RealExecution(request, {
      runId,
      outputDir,
      relativeOutputDir: relativeOutputDir(outputDir),
      targetRepoPath: validation.repoPath,
      sourceRepoPath: validation.repoPath,
      workspace,
      safety: validation.safety,
      now
    }, config);
    if (!result.ok) {
      const failedRun = await createFailedRealAgentRun(request, {
        runId,
        outputDir,
        relativeOutputDir: relativeOutputDir(outputDir),
        targetRepoPath: validation.repoPath,
        now,
        workspace,
        safety: validation.safety,
        code: result.error?.code || "agent2_real_run_failed",
        message: result.error?.message || "Agent(2) real execution failed.",
        details: result.error?.details || {}
      });
      agentRuns.set(runId, failedRun);
      persistAgentDryRun(failedRun, config);
      return { ok: true, data: failedRun, error: null };
    }
    await attachDirectTargetChanges(result.data, workspace);
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

async function validateRealAgentRequest(request = {}, config = {}) {
  if (request.dryRun !== false) {
    return blockedGate("agent_real_run_requires_dry_run_false", "Real Agent execution requires dryRun=false.");
  }
  if (request.realRunConfirm !== true) {
    return blockedGate("agent_real_run_confirmation_missing", "Real Agent execution requires realRunConfirm=true.");
  }
  if (selectedAgentProvider(request, config) !== "agent2") {
    return blockedGate("agent_real_run_provider_invalid", "Real Agent execution requires agentProvider=agent2.");
  }
  const requestedPath = request.repoPath || request.targetRepoPath || request.localPath || process.env.TARGET_REPO_PATH || "";
  if (!requestedPath) {
    return blockedGate("agent_target_repo_missing", "Real agent execution requires selected project localPath/targetRepoPath.");
  }
  const repoPath = path.resolve(requestedPath);
  const repoStat = await fs.stat(repoPath).catch(() => null);
  if (!repoStat?.isDirectory?.()) {
    return blockedGate("agent_target_repo_invalid", "Real agent execution target repo must be an existing directory.", { repoPath });
  }
  const workbenchRoot = path.resolve(config.workbenchRoot || process.cwd());
  if (isSameOrInside(repoPath, workbenchRoot)) {
    return blockedGate("agent_target_repo_is_workbench", "Real agent execution cannot target the Workbench repository itself.", {
      repoPath,
      workbenchRoot
    });
  }
  const repoPathCheck = validateRepoPathSegments(repoPath);
  if (!repoPathCheck.ok) {
    return blockedGate(repoPathCheck.code, repoPathCheck.message, { repoPath, segment: repoPathCheck.segment });
  }
  return {
    ok: true,
    repoPath,
    safety: {
      dryRunFalse: true,
      realRunConfirm: true,
      agentProvider: "agent2",
      repoPathValidated: true,
      workbenchSelfWriteBlocked: true,
      forbiddenTargetSegmentsBlocked: true,
      requestedRepoPath: requestedPath,
      repoPath
    }
  };
}

function blockedGate(code, message, details = {}) {
  return { ok: false, code, message, details };
}

async function createDirectTargetBaseline({ runId, repoPath, runsRoot }) {
  const runRoot = path.join(path.resolve(runsRoot), "workspaces", safeSegment(runId));
  const baselinePath = path.join(runRoot, "baseline");
  assertInside(path.resolve(runsRoot), runRoot);
  await fs.rm(runRoot, { recursive: true, force: true });
  await fs.mkdir(baselinePath, { recursive: true });
  await fs.cp(repoPath, baselinePath, {
    recursive: true,
    filter: (source) => !shouldExcludeBaselinePath(source, repoPath)
  });
  return {
    runId,
    adapterType: "direct_target",
    sourceRepoPath: repoPath,
    workspacePath: repoPath,
    baselinePath,
    baselineSnapshotId: `snapshot-${runId}-baseline`,
    directTargetRepoWrite: true,
    createdAt: new Date().toISOString()
  };
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
  const childResult = await runRealAgent2({
    command: pythonCommand,
    args: ["-m", "agent_core.main"],
    ...childOptions,
    agent2Runner: config.agent2Runner
  });
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

  const writeValidation = validateAgent2WriteReport(agent2Result, targetRepoPath);

  const run = mapAgent2ResultToWorkbench(agent2Result, {
    ...request,
    runId: options.runId,
    outputDir: options.outputDir,
    relativeOutputDir: options.relativeOutputDir,
    now: options.now,
    dryRun: false,
    realExecution: true,
    targetRepoPath,
    safety: options.safety,
    requirementDsl: inputDsl
  });
  run.startedAt = new Date(startedAt).toISOString();
  run.finishedAt = new Date().toISOString();
  run.changedFiles = writeValidation.changedFiles;
  run.safety = {
    ...(options.safety || {}),
    stdoutJsonParsed: true,
    changedFilesValidated: writeValidation.ok,
    forbiddenPathCheck: writeValidation.ok,
    noChanges: writeValidation.noChanges,
    changedFileCount: writeValidation.changedFiles.length
  };
  run.realWritePerformed = writeValidation.ok && !writeValidation.noChanges && run.realWritePerformed === true;
  if (!writeValidation.ok) {
    run.status = "failed";
    run.realWritePerformed = false;
    run.errorSummary = writeValidation.message;
    run.latestReturn = `Agent(2) real execution failed safety validation: ${writeValidation.message}`;
  } else if (writeValidation.noChanges) {
    run.status = "no_changes";
    run.realWritePerformed = false;
    run.latestReturn = "Agent(2) real execution completed but reported no changed files.";
  }
  run.stageEvents = buildAgentStageEvents({
    ...run,
    status: run.status === "failed" ? "failed" : run.status,
    errorSummary: run.errorSummary || ""
  });
  run.activityTimeline = run.stageEvents;
  run.plan = {
    ...(run.plan || {}),
    changedFiles: run.changedFiles,
    stageEvents: run.stageEvents,
    activityTimeline: run.stageEvents
  };
  if (run.artifacts?.["agent_activity_timeline.json"]) {
    run.artifacts["agent_activity_timeline.json"].json = {
      runId: options.runId,
      stageEvents: run.stageEvents,
      dryRun: false,
      realWritePerformed: run.realWritePerformed
    };
  }
  if (run.artifacts?.["agent2_result_preview.json"]?.json?.safety) {
    run.artifacts["agent2_result_preview.json"].json.safety = {
      ...run.artifacts["agent2_result_preview.json"].json.safety,
      ...run.safety,
      realWritePerformed: run.realWritePerformed
    };
  }
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
    sourceRepoPath,
    workspacePath: targetRepoPath,
    baselinePath: options.workspace?.baselinePath || "",
    baselineSnapshotId: options.workspace?.baselineSnapshotId || `snapshot-${options.runId}-baseline`,
    adapterType: options.workspace?.adapterType || "direct_target",
    directTargetRepoWrite: true,
    changedFiles: writeValidation.changedFiles.map((filePath) => ({
      id: `real-${filePath.replace(/[^A-Za-z0-9_.-]/g, "_")}`,
      filePath,
      status: "changed",
      changeType: "modified",
      changeSummary: `Agent(2) reported real write for ${filePath}`
    }))
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
    safety: run.safety,
    executionBoundary: {
      ...(run.context?.executionBoundary || {}),
      sourceRepoPath,
      targetRepoPath,
      directTargetRepoWrite: true,
      workbenchSelfWriteBlocked: true
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

async function attachDirectTargetChanges(run, workspace) {
  if (!workspace?.workspacePath || !workspace?.baselinePath) return;
  const changes = await getChangedFilesFromSnapshot({
    workspacePath: workspace.workspacePath,
    baselinePath: workspace.baselinePath
  });
  const reported = new Set((run.changedFiles || []).map((file) => String(file).replaceAll("\\", "/")));
  const filteredChanges = changes.filter((change) => !forbiddenWritePath(change.filePath));
  run.workspace = {
    ...(run.workspace || {}),
    ...workspace,
    changedFiles: filteredChanges.map((change) => ({
      ...change,
      changeSummary: reported.has(change.filePath)
        ? `Agent(2) reported real write for ${change.filePath}`
        : `${change.changeType} ${change.filePath}`
    }))
  };
  run.changedFiles = filteredChanges.map((change) => change.filePath);
  run.realWritePerformed = run.status !== "failed" && filteredChanges.length > 0;
  if (!filteredChanges.length && run.status !== "failed") {
    run.status = "no_changes";
    run.realWritePerformed = false;
    run.latestReturn = "Agent(2) real execution completed but target repo diff is empty.";
  }
  run.safety = {
    ...(run.safety || {}),
    targetRepoDiffScanned: true,
    changedFileCount: run.changedFiles.length
  };
  run.plan = {
    ...(run.plan || {}),
    changedFiles: run.changedFiles
  };
  run.stageEvents = buildAgentStageEvents(run);
  run.activityTimeline = run.stageEvents;
  run.plan.stageEvents = run.stageEvents;
  run.plan.activityTimeline = run.stageEvents;
  if (run.artifacts?.["agent_activity_timeline.json"]) {
    run.artifacts["agent_activity_timeline.json"].json = {
      runId: run.runId,
      stageEvents: run.stageEvents,
      dryRun: false,
      realWritePerformed: run.realWritePerformed
    };
  }
  if (run.artifacts?.["agent2_result_preview.json"]?.json?.safety) {
    run.artifacts["agent2_result_preview.json"].json.safety = {
      ...run.artifacts["agent2_result_preview.json"].json.safety,
      ...run.safety,
      realWritePerformed: run.realWritePerformed
    };
  }
  await writeWorkbenchArtifacts(run.outputDir, run.artifacts);
}

async function createFailedRealAgentRun(request = {}, options = {}) {
  const context = {
    runId: options.runId,
    projectId: request.projectId || "conduit-realworld-example-app",
    requirementId: request.requirementId || `req-agent-${options.runId}`,
    taskTitle: request.taskTitle || "Agent(2) real execution",
    source: "agent2_real_execution",
    agentProvider: "agent2",
    requirementDsl: request.requirementDsl || {},
    targetRepoPath: options.targetRepoPath,
    safety: options.safety || {},
    workspacePath: options.workspace?.workspacePath || options.targetRepoPath,
    executionBoundary: {
      dryRunDefault: false,
      realWriteDefault: true,
      runtimeStarted: true,
      workbenchSelfWriteBlocked: true,
      directTargetRepoWrite: true
    }
  };
  const run = {
    runId: options.runId,
    status: "failed",
    startedAt: options.now,
    finishedAt: new Date().toISOString(),
    dryRun: false,
    realWritePerformed: false,
    outputDir: options.outputDir,
    relativeOutputDir: options.relativeOutputDir,
    targetRepoPath: options.targetRepoPath,
    sourceRepoPath: options.targetRepoPath,
    workspace: options.workspace || null,
    changedFiles: [],
    errorSummary: options.message,
    latestReturn: options.message,
    safety: {
      ...(options.safety || {}),
      stdoutJsonParsed: false,
      changedFilesValidated: false,
      changedFileCount: 0
    },
    context,
    plan: {
      mode: "agent2_real_execution",
      taskName: context.taskTitle,
      executable: false,
      dryRun: false,
      summary: options.message,
      changedFiles: [],
      steps: []
    },
    review: {
      status: "blocked",
      summary: options.message,
      changedFiles: [],
      reviewItems: [{ severity: "high", message: options.message }],
      tests: [],
      manualConfirmations: ["Fix Agent(2) runtime failure and rerun."]
    },
    prDraft: {
      title: context.taskTitle,
      summary: [options.message],
      body: "",
      changedFiles: [],
      tests: [],
      risks: ["Agent(2) real execution failed."],
      checklist: ["Review Agent(2) stderr/stdout artifacts before retry."],
      sourceRun: options.runId
    },
    executionResult: {
      executed: false,
      mode: "failed",
      files: [],
      summary: options.message,
      code: options.code,
      details: options.details || {}
    }
  };
  run.stageEvents = buildAgentStageEvents(run);
  run.activityTimeline = run.stageEvents;
  run.plan.stageEvents = run.stageEvents;
  run.plan.activityTimeline = run.stageEvents;
  run.artifacts = {
    "agent2_real_error.json": {
      exists: true,
      path: path.join(options.outputDir, "agent2_real_error.json"),
      json: {
        code: options.code,
        message: options.message,
        details: options.details || {},
        safety: run.safety
      }
    },
    "agent_activity_timeline.json": {
      exists: true,
      path: path.join(options.outputDir, "agent_activity_timeline.json"),
      json: {
        runId: options.runId,
        stageEvents: run.stageEvents,
        dryRun: false,
        realWritePerformed: false
      }
    }
  };
  await writeWorkbenchArtifacts(options.outputDir, run.artifacts);
  return run;
}

function validateAgent2WriteReport(agent2Result = {}, repoPath = "") {
  const executionResult = agent2Result.execution_result && typeof agent2Result.execution_result === "object"
    ? agent2Result.execution_result
    : {};
  const writtenFiles = (Array.isArray(executionResult.files) ? executionResult.files : [])
    .filter((file) => file?.real_write === true || file?.applied === true || file?.status === "applied" || Number(file?.bytes_written || 0) > 0);
  if (!writtenFiles.length) {
    return {
      ok: true,
      noChanges: true,
      changedFiles: [],
      message: "Agent(2) completed without reporting changed files."
    };
  }
  const changedFiles = [];
  for (const file of writtenFiles) {
    const filePath = file.file || file.path || file.filePath || file.relative_path;
    const check = validateWritePath(filePath, repoPath);
    if (!check.ok) return { ...check, noChanges: false, changedFiles };
    changedFiles.push(check.relativePath);
  }
  return {
    ok: true,
    noChanges: false,
    changedFiles: [...new Set(changedFiles)],
    message: "Agent(2) reported changed files inside the target repo."
  };
}

function validateWritePath(value, repoPath) {
  if (!value) {
    return { ok: false, code: "agent2_changed_file_missing", message: "Agent(2) reported a changed file without a path." };
  }
  const raw = String(value).replaceAll("\\", "/");
  if (raw.includes("\0")) {
    return { ok: false, code: "agent2_changed_file_invalid", message: `Changed file path contains invalid characters: ${value}` };
  }
  const resolvedRepo = path.resolve(repoPath);
  const resolvedPath = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(resolvedRepo, raw);
  if (!isSameOrInside(resolvedPath, resolvedRepo) || resolvedPath === resolvedRepo) {
    return { ok: false, code: "agent2_changed_file_outside_repo", message: `Changed file escapes target repo: ${value}` };
  }
  const relativePath = path.relative(resolvedRepo, resolvedPath).replaceAll("\\", "/");
  const forbidden = forbiddenWritePath(relativePath);
  if (forbidden) {
    return { ok: false, code: "agent2_forbidden_write_path", message: `Changed file is forbidden: ${relativePath}`, relativePath };
  }
  return { ok: true, relativePath };
}

function validateRepoPathSegments(repoPath) {
  const parts = path.resolve(repoPath).split(/[\\/]+/).filter(Boolean).map((part) => part.toLowerCase());
  const blocked = parts.find((part) => ["node_modules", "dist", "runs"].includes(part));
  if (blocked) {
    return {
      ok: false,
      code: "agent_target_repo_forbidden_segment",
      message: `Real agent target repo cannot include ${blocked}.`,
      segment: blocked
    };
  }
  if (parts.at(-1) === ".git") {
    return {
      ok: false,
      code: "agent_target_repo_git_dir",
      message: "Real agent target repo cannot be a .git directory.",
      segment: ".git"
    };
  }
  return { ok: true };
}

function forbiddenWritePath(relativePath) {
  const normalized = String(relativePath || "").replaceAll("\\", "/").replace(/^\/+/, "");
  const lower = normalized.toLowerCase();
  const parts = lower.split("/").filter(Boolean);
  if (!normalized || normalized.includes("..") || path.isAbsolute(normalized)) return true;
  if (parts.some((part) => ["node_modules", "dist", "runs", ".git"].includes(part))) return true;
  const basename = parts.at(-1) || "";
  if (basename === ".env") return true;
  if (basename === "api_config.local.json") return true;
  if (basename.endsWith(".local.json")) return true;
  if (basename.endsWith(".db") || basename.includes(".db-")) return true;
  if (basename.endsWith(".sqlite") || /\.sqlite-/i.test(basename)) return true;
  if (parts.length >= 2 && parts[0] === "data" && (basename.endsWith(".sqlite") || /\.sqlite-/i.test(basename))) return true;
  return false;
}

function shouldExcludeBaselinePath(source, repoPath) {
  const relative = path.relative(repoPath, source).replaceAll("\\", "/");
  if (!relative) return false;
  const parts = relative.toLowerCase().split("/").filter(Boolean);
  if (parts.some((part) => [".git", "node_modules", "dist", "runs"].includes(part))) return true;
  const basename = parts.at(-1) || "";
  return basename.endsWith(".pyc") ||
    basename === ".env" ||
    basename === "api_config.local.json" ||
    basename.endsWith(".local.json") ||
    basename.endsWith(".db") ||
    basename.endsWith(".sqlite") ||
    /\.sqlite-/i.test(basename);
}

function assertInside(parentPath, childPath) {
  if (!isSameOrInside(childPath, parentPath) || path.resolve(childPath) === path.resolve(parentPath)) {
    throw Object.assign(new Error("computed path escapes expected root"), {
      code: "unsafe_computed_path",
      details: { parentPath, childPath }
    });
  }
}

function isSameOrInside(childPath, parentPath) {
  const child = path.resolve(childPath);
  const parent = path.resolve(parentPath);
  return child === parent || child.startsWith(`${parent}${path.sep}`);
}

function safeSegment(value) {
  return String(value || "run").replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 80);
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
      prDraft: run.prDraft,
      changedFiles: run.changedFiles || run.review?.changedFiles?.map((item) => item.file || item.filePath).filter(Boolean) || []
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
        changedFiles: run.planJson?.changedFiles || reviewItems.map((item) => item.filePath).filter(Boolean),
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
    changedFiles: memoryRun?.changedFiles || plan.changedFiles || [],
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
