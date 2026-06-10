import path from "node:path";
import { spawn } from "node:child_process";
import { redactSecrets } from "./redactionService.js";

const agent2Root = path.resolve("agent(2)", "agent");
const blockedModes = [
  "real_repo_apply",
  "AGENT_REPO_CONFIRM=YES",
  "AGENT_TEST_CONFIRM=YES",
  "AGENT_REPO_APPLY=1",
  "AGENT_TEST_RUN=1"
];

export function createAgent2DryRun(request = {}, options = {}) {
  const result = request.agent2Result || buildFixtureAgent2Result(request);
  return mapAgent2ResultToWorkbench(result, { ...request, ...options, dryRun: true, realExecution: false });
}

export async function runRealAgent2(options = {}) {
  const command = options.command || "python";
  const args = Array.isArray(options.args) ? options.args : ["-m", "agent_core.main"];
  const childOptions = {
    cwd: options.cwd,
    env: options.env,
    input: options.input,
    spawnImpl: options.spawnImpl,
    timeoutMs: options.timeoutMs
  };
  return typeof options.agent2Runner === "function"
    ? options.agent2Runner({ command, args, ...childOptions })
    : spawnWithInput(command, args, childOptions);
}

export function mapAgent2ResultToWorkbench(agent2Result = {}, contextInput = {}) {
  const now = contextInput.now || new Date().toISOString();
  const runId = contextInput.runId || agent2Result.run_id || agent2Result.task_id || "RUN-agent2-preview";
  const realExecution = contextInput.realExecution === true || contextInput.dryRun === false;
  const failed = isAgent2Failure(agent2Result);
  const failureMessage = agent2FailureMessage(agent2Result);
  const rawExecutionResult = objectOrEmpty(agent2Result.execution_result);
  const executionResult = failed && Object.keys(rawExecutionResult).length === 0
    ? { executed: false, mode: "failed", files: [], summary: failureMessage }
    : rawExecutionResult;
  const realWritePerformed = realExecution && executionWritesFiles(executionResult);
  const executionSummary = typeof executionResult.summary === "string" ? executionResult.summary : "";
  const taskTitle = contextInput.taskTitle || agent2Result.task_name || (realExecution ? "Agent(2) real execution" : "Agent(2) dry-run preview");
  const requirementId = contextInput.requirementId || agent2Result.requirement_id || `req-agent-${runId}`;
  const normalizedAgent2Result = failed
    ? {
        ...agent2Result,
        execution_result: executionResult,
        review_result: Object.keys(objectOrEmpty(agent2Result.review_result)).length ? agent2Result.review_result : {
          approved: false,
          risk_level: "high",
          summary: failureMessage,
          issues: [failureMessage],
          required_fixes: ["Fix Agent(2) runtime failure and rerun."]
        }
      }
    : agent2Result;
  const context = buildContext(normalizedAgent2Result, contextInput, runId, requirementId, taskTitle);
  const plan = buildPlan(normalizedAgent2Result, taskTitle);
  const review = buildReview(normalizedAgent2Result, plan, context);
  const prDraft = buildPrDraft(agent2Result, review, context);
  const artifactJson = {
    "agent2_context.json": context,
    "agent2_plan_preview.json": plan,
    "agent2_review_check.json": review,
    "agent2_pr_draft.json": prDraft,
    "agent2_result_preview.json": {
      source: contextInput.agent2Result ? "request_agent2_result" : "workbench_fixture",
      agent2Root,
      result: redactSecrets(agent2Result),
      safety: {
        dryRun: !realExecution,
        realWritePerformed,
        upstreamExecutionReported: Boolean(normalizedAgent2Result.execution_result?.executed),
        blockedModes,
        repoApplyEnabled: Boolean(agent2Result.safety_gates?.repo_apply_enabled),
        repoConfirmed: Boolean(agent2Result.safety_gates?.repo_confirmed),
        testRunEnabled: Boolean(agent2Result.safety_gates?.test_run_enabled),
        testConfirmed: Boolean(agent2Result.safety_gates?.test_confirmed)
      }
    }
  };
  const stageEvents = buildAgentStageEvents({
    runId,
    status: failed ? "failed" : "completed",
    startedAt: now,
    finishedAt: now,
    dryRun: !realExecution,
    realWritePerformed,
    context,
    plan,
    review,
    prDraft,
    artifacts: artifactJson,
    executionResult,
    latestReturn: failureMessage,
    errorSummary: failed ? failureMessage : ""
  });
  plan.stageEvents = Array.isArray(stageEvents) ? stageEvents : [];
  plan.activityTimeline = plan.stageEvents;
  artifactJson["agent_activity_timeline.json"] = {
    runId,
    stageEvents: plan.stageEvents,
    dryRun: !realExecution,
    realWritePerformed
  };

  return {
    runId,
    status: failed ? "failed" : "completed",
    startedAt: now,
    finishedAt: now,
    dryRun: !realExecution,
    realWritePerformed,
    outputDir: contextInput.outputDir || "",
    relativeOutputDir: contextInput.relativeOutputDir || "",
    latestReturn: realExecution
      ? failed
        ? `Agent(2) real execution failed for ${taskTitle}: ${failureMessage}`
        : `Agent(2) real execution finished for ${taskTitle}; realWritePerformed=${realWritePerformed}.${!realWritePerformed && executionSummary ? ` ${executionSummary}.` : ""}`
      : `Agent(2) dry-run adapter generated a Workbench preview for ${taskTitle}; no runtime execution or repo writes performed.`,
    stageEvents: plan.stageEvents,
    activityTimeline: plan.stageEvents,
    progress: [
      { step: "readiness", status: "completed" },
      { step: realExecution ? "agent2_runtime" : "agent2_contract_mapping", status: failed ? "failed" : "completed" },
      { step: realExecution ? "real_patch_execution" : "plan_preview", status: executionResult.executed ? "completed" : "blocked" },
      { step: "review_check", status: review.status },
      { step: "pr_draft", status: "prepared" }
    ],
    context,
    plan,
    review,
    prDraft,
    changedFiles: review.changedFiles.map((item) => item.file),
    executionResult,
    reviewResult: objectOrEmpty(normalizedAgent2Result.review_result),
    artifacts: Object.fromEntries(Object.entries(artifactJson).map(([name, json]) => [name, {
      exists: true,
      path: contextInput.outputDir ? path.join(contextInput.outputDir, name) : "",
      json
    }]))
  };
}

function buildContext(agent2Result, contextInput, runId, requirementId, taskTitle) {
  const realExecution = contextInput.realExecution === true || contextInput.dryRun === false;
  return {
    runId,
    projectId: contextInput.projectId || "conduit-realworld-example-app",
    requirementId,
    taskTitle,
    source: realExecution ? "agent2_real_execution" : "agent2_dry_run_adapter",
    agentProvider: "agent2",
    requirementDsl: contextInput.requirementDsl || {
      id: requirementId,
      title: taskTitle,
      ready_for_agent: realExecution,
      handoff_decision: realExecution ? "agent_real_execution" : "dry_run_preview"
    },
    targetRepoPath: contextInput.targetRepoPath || process.env.TARGET_REPO_PATH || "not_set",
    executionBoundary: {
      dryRunDefault: !realExecution,
      realWriteDefault: realExecution,
      agent2SourcePath: agent2Root,
      runtimeStarted: realExecution,
      pythonSpawned: realExecution,
      serviceStarted: false,
      blockedModes: realExecution ? [] : blockedModes,
      safetyGates: redactSecrets(agent2Result.safety_gates || {})
    }
  };
}

function buildPlan(agent2Result, taskTitle) {
  const execution = objectOrEmpty(agent2Result.execution_result);
  const realExecution = execution.mode === "real_repo_apply" || executionWritesFiles(execution);
  const patchPlan = objectOrEmpty(agent2Result.patch_plan);
  const locatedFiles = fileList(agent2Result);
  const steps = normalizeSteps(agent2Result.selected_actions);
  return {
    mode: realExecution ? "agent2_real_execution" : "agent2_dry_run_adapter",
    taskName: taskTitle,
    executable: true,
    dryRun: !realExecution,
    agent2Status: agent2Result.status || agent2Result.raw_status || "preview",
    summary: patchPlan.summary || agent2Result.summary?.plan_summary || (realExecution ? "Agent(2) real execution mapped to Workbench plan." : "Agent(2) preview contract mapped to Workbench plan."),
    steps,
    targetFiles: filesFromPatchPlan(patchPlan).length ? filesFromPatchPlan(patchPlan) : locatedFiles,
    safeguards: realExecution
      ? [
          "Agent(2) runtime was started by Workbench.",
          "AGENT_REPO_MODE=real, AGENT_REPO_APPLY=1, and AGENT_REPO_CONFIRM=YES were set for this run.",
          "Target repository writes are reported through execution_result.files.",
          "Secrets are redacted before Workbench persistence."
        ]
      : [
          "Agent(2) runtime was not started by Workbench.",
          "Python Agent(2) process was not spawned.",
          "No AGENT_REPO_CONFIRM=YES or AGENT_TEST_CONFIRM=YES path is exposed.",
          "No target repository writes are performed by this adapter."
        ]
  };
}

function buildReview(agent2Result, plan, context) {
  const review = objectOrEmpty(agent2Result.review_result);
  const executionResult = objectOrEmpty(agent2Result.execution_result);
  const executionSummary = typeof executionResult.summary === "string" ? executionResult.summary : "";
  const executionBlocked = executionResult.executed === false && /blocked|not approved|missing review/i.test(executionSummary);
  const executionFailed = String(executionResult.mode || "").toLowerCase() === "failed";
  const patchPlan = objectOrEmpty(agent2Result.patch_plan);
  const realExecution = context.executionBoundary?.realWriteDefault === true;
  const files = prChangedFiles(agent2Result.pr_draft).length
    ? prChangedFiles(agent2Result.pr_draft)
    : patchesAsChangedFiles(patchPlan, context);
  return {
    status: review.approved ? "approved" : executionBlocked || executionFailed ? "blocked" : "needs_review",
    summary: review.summary || executionSummary || (realExecution ? "Agent(2) real execution finished and needs human review." : "Agent(2) preview needs human review before any real write."),
    changedFiles: files.map((file) => ({
      file: file.file,
      changeSummary: file.changeSummary || file.operation || "Agent(2) planned change",
      why: file.why || file.reason || "Mapped from Agent(2) patch plan and RequirementDSL.",
      risk: file.risk || file.risk_level || review.risk_level || (realExecution ? "real execution review required" : "preview review required"),
      requirementPoint: file.requirementPoint || context.requirementDsl.title || context.taskTitle
    })),
    reviewItems: (review.issues || []).map((issue) => ({
      severity: review.risk_level || "medium",
      message: String(issue)
    })),
    tests: normalizeTests(agent2Result),
    manualConfirmations: realExecution
      ? [
          ...toStringList(agent2Result.pr_draft?.manual_checklist),
          "Confirm target repo diff matches the requirement.",
          "Confirm no secrets or local config files were modified."
        ]
      : [
          ...toStringList(agent2Result.pr_draft?.manual_checklist),
          "Confirm target repo is clean before any future real write.",
          "Confirm Agent(2) safety gates remain preview only."
        ]
  };
}

function buildPrDraft(agent2Result, review, context) {
  const draft = objectOrEmpty(agent2Result.pr_draft);
  const realExecution = context.executionBoundary?.realWriteDefault === true;
  const changedFiles = review.changedFiles.map((item) => item.file);
  return {
    title: draft.title || context.taskTitle,
    summary: toStringList(draft.summary || agent2Result.patch_plan?.summary || review.summary),
    body: draft.body || "",
    changedFiles,
    tests: normalizeTests(agent2Result),
    risks: review.changedFiles.map((item) => item.risk),
    checklist: realExecution
      ? [
          ...toStringList(draft.manual_checklist),
          "Real Agent(2) run reviewed",
          "Target repository diff checked",
          "No API keys or local configs committed"
        ]
      : [
          ...toStringList(draft.manual_checklist),
          "Preview artifacts reviewed",
          "No Agent(2) real write executed",
          "No API keys or local configs committed"
        ],
    sourceRun: context.runId
  };
}

function normalizeSteps(actions = []) {
  const mapped = (Array.isArray(actions) ? actions : []).map((action) => {
    const key = action.selected_action || action.selected_tool || action.action || "";
    const name = stepName(key);
    return {
      name,
      owner: action.selected_tool || action.selected_action || "agent2",
      output: action.reason || `Agent(2) ${name} preview`
    };
  });
  const required = [
    { name: "Analyze RequirementDSL", owner: "agent2_planner", output: "implementation intent and acceptance criteria" },
    { name: "Locate Files", owner: "agent2_locator", output: "candidate file list for human review" },
    { name: "Review Patch", owner: "agent2_reviewer", output: "risk and requirement mapping" }
  ];
  for (const step of required) {
    if (!mapped.some((item) => item.name === step.name)) mapped.push(step);
  }
  return mapped;
}

function stepName(key) {
  const normalized = String(key || "").toLowerCase();
  if (normalized.includes("plan")) return "Analyze RequirementDSL";
  if (normalized.includes("locate")) return "Locate Files";
  if (normalized.includes("draft") || normalized.includes("generate")) return "Generate Patch Preview";
  if (normalized.includes("validate")) return "Validate Patch";
  if (normalized.includes("review")) return "Review Patch";
  if (normalized.includes("execute")) return "Execution Blocked";
  if (normalized.includes("verify")) return "Verify Preview";
  if (normalized.includes("finish") || normalized.includes("summarize")) return "Summarize Result";
  return "Agent(2) Step";
}

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function isAgent2Failure(agent2Result = {}) {
  const status = String(agent2Result.status || agent2Result.raw_status || "").toLowerCase();
  return status === "failed" || status === "failure" || status === "error";
}

function agent2FailureMessage(agent2Result = {}) {
  const summary = objectOrEmpty(agent2Result.summary);
  const risks = objectOrEmpty(agent2Result.risks);
  return String(
    summary.message ||
    agent2Result.error ||
    risks.last_error ||
    "Agent(2) runtime failed before producing a patch plan."
  );
}

function fileList(agent2Result) {
  return (agent2Result.located_files?.files || [])
    .map((file) => file.relative_path || file.file || file.path)
    .filter(Boolean)
    .map((file) => String(file).replaceAll("\\", "/"));
}

function filesFromPatchPlan(patchPlan) {
  return (patchPlan.patches || [])
    .map((patch) => patch.file || patch.path)
    .filter(Boolean)
    .map((file) => String(file).replaceAll("\\", "/"));
}

function patchesAsChangedFiles(patchPlan, context) {
  const patches = Array.isArray(patchPlan.patches) ? patchPlan.patches : [];
  const realExecution = context.executionBoundary?.realWriteDefault === true;
  if (!patches.length) {
    return (context.requirementDsl.targetFiles || []).map((file) => ({
      file,
      changeSummary: "Candidate file from RequirementDSL",
      why: "Provided by Workbench request",
      risk: realExecution ? "real execution review required" : "preview review required"
    }));
  }
  return patches.map((patch) => ({
    file: String(patch.file || patch.path || "").replaceAll("\\", "/"),
    changeSummary: Array.isArray(patch.changes) ? patch.changes.join("; ") : patch.operation || "Agent(2) planned change",
    why: patch.reason,
    risk: patch.risk_level
  })).filter((patch) => patch.file);
}

function prChangedFiles(prDraft = {}) {
  return (prDraft.changed_files || prDraft.changedFiles || [])
    .map((item) => typeof item === "string" ? { file: item } : {
      file: item.file,
      operation: item.operation,
      reason: item.reason,
      risk_level: item.risk_level,
      changeSummary: Array.isArray(item.changes) ? item.changes.join("; ") : item.changeSummary
    })
    .filter((item) => item.file);
}

function normalizeTests(agent2Result) {
  const draft = objectOrEmpty(agent2Result.pr_draft);
  const commands = [
    ...toStringList(draft.test_commands || draft.tests),
    ...toStringList(agent2Result.test_commands)
  ];
  return [...new Set(commands.length ? commands : ["npm test", "npm run build"])]
    .map((command) => ({ command, status: "planned" }));
}

function executionWritesFiles(executionResult = {}) {
  const files = Array.isArray(executionResult.files) ? executionResult.files : [];
  return executionResult.executed === true && files.some((file) =>
    file?.real_write === true ||
    file?.applied === true ||
    file?.status === "applied" ||
    Number(file?.bytes_written || 0) > 0
  );
}

function toStringList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
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

export const agentStageDefinitions = [
  ["requirement", "RequirementAgent", "读取 RequirementDSL / 设计输入"],
  ["readiness", "ReadinessAgent", "检查 dry-run 执行条件"],
  ["context", "ContextAgent", "编译 Agent 上下文"],
  ["planner", "PlannerAgent", "生成任务拆解"],
  ["locator", "LocatorAgent", "定位相关文件"],
  ["patchPlan", "PatchPlanAgent", "生成候选修改方案"],
  ["review", "ReviewAgent", "生成审阅项和风险"],
  ["prDraft", "PRDraftAgent", "生成 PR 草稿"],
  ["artifact", "ArtifactAgent", "汇总 artifacts"],
  ["summary", "SummaryAgent", "汇总结果"]
];

export function buildAgentStageEvents(run = {}) {
  const now = run.finishedAt || run.startedAt || new Date().toISOString();
  const failed = run.status === "failed" || Boolean(run.errorSummary);
  const artifactCount = Object.keys(run.artifacts || {}).length;
  const hasContext = hasObject(run.context);
  const hasPlan = hasObject(run.plan) && (Array.isArray(run.plan.steps) && run.plan.steps.length || run.plan.summary || run.plan.taskName);
  const hasTargets = Array.isArray(run.plan?.targetFiles) && run.plan.targetFiles.length || Array.isArray(run.review?.changedFiles) && run.review.changedFiles.length;
  const hasPatchPlan = hasTargets || String(run.plan?.summary || "").trim();
  const hasReview = hasObject(run.review) && (Array.isArray(run.review.changedFiles) && run.review.changedFiles.length || run.review.summary || run.review.status);
  const hasPrDraft = hasObject(run.prDraft) && (run.prDraft.title || run.prDraft.body || toStringList(run.prDraft.summary).length || toStringList(run.prDraft.checklist).length);
  const hasSummary = Boolean(run.latestReturn || run.resultSummary || run.executionResult?.summary);
  const dryRunSafe = run.dryRun !== false && run.realWritePerformed !== true;
  const realRunConfirmed = run.dryRun === false && run.safety?.realRunConfirm === true && run.safety?.repoPathValidated === true;
  const readinessComplete = dryRunSafe || realRunConfirmed;

  const statusByKey = {
    requirement: hasContext ? "completed" : "skipped",
    readiness: readinessComplete ? "completed" : "blocked",
    context: hasContext ? "completed" : "skipped",
    planner: hasPlan ? "completed" : "skipped",
    locator: hasTargets ? "completed" : "skipped",
    patchPlan: hasPatchPlan ? "completed" : "skipped",
    review: hasReview ? "completed" : "skipped",
    prDraft: hasPrDraft ? "completed" : "skipped",
    artifact: artifactCount > 0 ? "completed" : "skipped",
    summary: failed ? "failed" : hasSummary ? "completed" : "skipped"
  };
  const summaryByKey = {
    requirement: run.context?.requirementDsl?.title || run.context?.taskTitle || "Requirement input was read.",
    readiness: realRunConfirmed ? "dryRun=false, realRunConfirm=true, and repoPath validation passed." : dryRunSafe ? "dryRun=true and realWritePerformed=false." : "Run boundary is not safe.",
    context: hasContext ? "Agent context snapshot is available." : "No context snapshot was produced.",
    planner: hasPlan ? `${run.plan.steps?.length || 0} plan step(s) available.` : "No plan output was produced.",
    locator: hasTargets ? `${(run.plan?.targetFiles || run.review?.changedFiles || []).length} file target(s) available.` : "No located files were produced.",
    patchPlan: hasPatchPlan ? "Candidate modification plan is available." : "No candidate patch plan was produced.",
    review: hasReview ? run.review.summary || "Review items and risks are available." : "No review output was produced.",
    prDraft: hasPrDraft ? run.prDraft.title || "PR draft is available." : "No PR draft was produced.",
    artifact: artifactCount > 0 ? `${artifactCount} artifact(s) captured.` : "No artifacts were captured.",
    summary: failed ? run.errorSummary : run.latestReturn || run.resultSummary || run.executionResult?.summary || "No summary was produced."
  };

  return agentStageDefinitions.map(([key, agent, title], index) => ({
    id: `${run.runId || "agent-run"}:${key}`,
    key,
    agent,
    title,
    summary: summaryByKey[key],
    status: statusByKey[key],
    startedAt: run.startedAt || now,
    finishedAt: ["completed", "skipped", "blocked", "failed"].includes(statusByKey[key]) ? now : "",
    errorSummary: statusByKey[key] === "failed" ? String(run.errorSummary || "") : "",
    order: index + 1
  }));
}

function hasObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0;
}

function buildFixtureAgent2Result(request = {}) {
  const title = request.taskTitle || "Agent(2) dry-run request";
  return {
    task_id: "workbench_fixture",
    status: "preview",
    task_name: title,
    selected_actions: [
      { selected_action: "plan_task", selected_tool: "make_plan", reason: "Analyze RequirementDSL without runtime execution." },
      { selected_action: "locate_files", selected_tool: "locate_files", reason: "Use Workbench fixture candidates for dry-run preview." },
      { selected_action: "review_patch", selected_tool: "review_patch", reason: "Require human review before writes." }
    ],
    located_files: {
      files: [
        { relative_path: "src/components/DesignPlanningWorkbench.jsx", reason: "Workbench planning surface" },
        { relative_path: "src/components/ReviewCheckWorkbench.jsx", reason: "Workbench review surface" },
        { relative_path: "src/components/PRWorkbench.jsx", reason: "Workbench PR draft surface" }
      ]
    },
    patch_plan: {
      summary: "Map Agent(2) JSON contract into existing Workbench preview fields.",
      patches: [
        {
          file: "server/services/agent2Adapter.js",
          operation: "add",
          changes: ["Create dry-run adapter", "Map plan, review, PR draft, artifacts"],
          reason: "Keep Agent(2) integration behind a safe adapter boundary",
          risk_level: "low"
        }
      ]
    },
    review_result: {
      approved: false,
      risk_level: "medium",
      summary: "Dry-run adapter output is ready for human review.",
      issues: ["Real Agent(2) runtime execution remains blocked by Workbench."]
    },
    execution_result: {
      executed: false,
      mode: "dry_run",
      summary: "Workbench fixture only; no repo writes performed."
    },
    verification_result: {
      passed: false,
      verified: false,
      reason: "Unit and build tests must be run by Workbench task."
    },
    pr_draft: {
      title,
      summary: "Agent(2) dry-run adapter preview.",
      changed_files: [{ file: "server/services/agent2Adapter.js", operation: "add", risk_level: "low" }],
      test_commands: ["npm run test:server", "npm run build"],
      manual_checklist: ["Confirm no frontend process was restarted."]
    },
    safety_gates: {
      repo_apply_enabled: false,
      repo_confirmed: false,
      test_run_enabled: false,
      test_confirmed: false,
      repo_mode: "mock"
    }
  };
}
