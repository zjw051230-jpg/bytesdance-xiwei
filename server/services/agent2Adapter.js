import path from "node:path";
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
  return mapAgent2ResultToWorkbench(result, { ...request, ...options });
}

export function mapAgent2ResultToWorkbench(agent2Result = {}, contextInput = {}) {
  const now = contextInput.now || new Date().toISOString();
  const runId = contextInput.runId || agent2Result.run_id || agent2Result.task_id || "RUN-agent2-preview";
  const taskTitle = contextInput.taskTitle || agent2Result.task_name || "Agent(2) dry-run preview";
  const requirementId = contextInput.requirementId || agent2Result.requirement_id || `req-agent-${runId}`;
  const context = buildContext(agent2Result, contextInput, runId, requirementId, taskTitle);
  const plan = buildPlan(agent2Result, taskTitle);
  const review = buildReview(agent2Result, plan, context);
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
        dryRun: true,
        realWritePerformed: false,
        upstreamExecutionReported: Boolean(agent2Result.execution_result?.executed),
        blockedModes,
        repoApplyEnabled: Boolean(agent2Result.safety_gates?.repo_apply_enabled),
        repoConfirmed: Boolean(agent2Result.safety_gates?.repo_confirmed),
        testRunEnabled: Boolean(agent2Result.safety_gates?.test_run_enabled),
        testConfirmed: Boolean(agent2Result.safety_gates?.test_confirmed)
      }
    }
  };

  return {
    runId,
    status: "completed",
    startedAt: now,
    finishedAt: now,
    dryRun: true,
    realWritePerformed: false,
    outputDir: contextInput.outputDir || "",
    relativeOutputDir: contextInput.relativeOutputDir || "",
    latestReturn: `Agent(2) dry-run adapter generated a Workbench preview for ${taskTitle}; no runtime execution or repo writes performed.`,
    progress: [
      { step: "readiness", status: "completed" },
      { step: "agent2_contract_mapping", status: "completed" },
      { step: "plan_preview", status: "completed" },
      { step: "review_check", status: review.status },
      { step: "pr_draft", status: "prepared" }
    ],
    context,
    plan,
    review,
    prDraft,
    artifacts: Object.fromEntries(Object.entries(artifactJson).map(([name, json]) => [name, {
      exists: true,
      path: contextInput.outputDir ? path.join(contextInput.outputDir, name) : "",
      json
    }]))
  };
}

function buildContext(agent2Result, contextInput, runId, requirementId, taskTitle) {
  return {
    runId,
    projectId: contextInput.projectId || "conduit-realworld-example-app",
    requirementId,
    taskTitle,
    source: "agent2_dry_run_adapter",
    agentProvider: "agent2",
    requirementDsl: contextInput.requirementDsl || {
      id: requirementId,
      title: taskTitle,
      ready_for_agent: false,
      handoff_decision: "dry_run_preview"
    },
    targetRepoPath: contextInput.targetRepoPath || process.env.TARGET_REPO_PATH || "not_set",
    executionBoundary: {
      dryRunDefault: true,
      realWriteDefault: false,
      agent2SourcePath: agent2Root,
      runtimeStarted: false,
      pythonSpawned: false,
      serviceStarted: false,
      blockedModes,
      safetyGates: redactSecrets(agent2Result.safety_gates || {})
    }
  };
}

function buildPlan(agent2Result, taskTitle) {
  const patchPlan = objectOrEmpty(agent2Result.patch_plan);
  const locatedFiles = fileList(agent2Result);
  const steps = normalizeSteps(agent2Result.selected_actions);
  return {
    mode: "agent2_dry_run_adapter",
    taskName: taskTitle,
    executable: true,
    dryRun: true,
    agent2Status: agent2Result.status || agent2Result.raw_status || "preview",
    summary: patchPlan.summary || agent2Result.summary?.plan_summary || "Agent(2) dry-run contract mapped to Workbench plan.",
    steps,
    targetFiles: filesFromPatchPlan(patchPlan).length ? filesFromPatchPlan(patchPlan) : locatedFiles,
    safeguards: [
      "Agent(2) runtime was not started by Workbench.",
      "Python Agent(2) process was not spawned.",
      "No AGENT_REPO_CONFIRM=YES or AGENT_TEST_CONFIRM=YES path is exposed.",
      "No target repository writes are performed by this adapter."
    ]
  };
}

function buildReview(agent2Result, plan, context) {
  const review = objectOrEmpty(agent2Result.review_result);
  const patchPlan = objectOrEmpty(agent2Result.patch_plan);
  const files = prChangedFiles(agent2Result.pr_draft).length
    ? prChangedFiles(agent2Result.pr_draft)
    : patchesAsChangedFiles(patchPlan, context);
  return {
    status: review.approved ? "approved" : "needs_review",
    summary: review.summary || agent2Result.execution_result?.summary || "Agent(2) dry-run preview needs human review before any real write.",
    changedFiles: files.map((file) => ({
      file: file.file,
      changeSummary: file.changeSummary || file.operation || "Agent(2) planned change",
      why: file.why || file.reason || "Mapped from Agent(2) patch plan and RequirementDSL.",
      risk: file.risk || file.risk_level || review.risk_level || "dry-run review required",
      requirementPoint: file.requirementPoint || context.requirementDsl.title || context.taskTitle
    })),
    reviewItems: (review.issues || []).map((issue) => ({
      severity: review.risk_level || "medium",
      message: String(issue)
    })),
    tests: normalizeTests(agent2Result),
    manualConfirmations: [
      ...toStringList(agent2Result.pr_draft?.manual_checklist),
      "Confirm target repo is clean before any future real write.",
      "Confirm Agent(2) safety gates remain dry-run only."
    ]
  };
}

function buildPrDraft(agent2Result, review, context) {
  const draft = objectOrEmpty(agent2Result.pr_draft);
  const changedFiles = review.changedFiles.map((item) => item.file);
  return {
    title: draft.title || context.taskTitle,
    summary: toStringList(draft.summary || agent2Result.patch_plan?.summary || review.summary),
    body: draft.body || "",
    changedFiles,
    tests: normalizeTests(agent2Result),
    risks: review.changedFiles.map((item) => item.risk),
    checklist: [
      ...toStringList(draft.manual_checklist),
      "Dry-run artifacts reviewed",
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

function fileList(agent2Result) {
  return (agent2Result.located_files?.files || [])
    .map((file) => file.relative_path || file.file || file.path)
    .filter(Boolean)
    .map((file) => String(file).replaceAll("\\", "/"));
}

function filesFromPatchPlan(patchPlan) {
  return (patchPlan.patches || [])
    .map((patch) => patch.file)
    .filter(Boolean)
    .map((file) => String(file).replaceAll("\\", "/"));
}

function patchesAsChangedFiles(patchPlan, context) {
  const patches = Array.isArray(patchPlan.patches) ? patchPlan.patches : [];
  if (!patches.length) {
    return (context.requirementDsl.targetFiles || []).map((file) => ({
      file,
      changeSummary: "Candidate file from RequirementDSL",
      why: "Provided by Workbench request",
      risk: "dry-run review required"
    }));
  }
  return patches.map((patch) => ({
    file: String(patch.file || "").replaceAll("\\", "/"),
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

function toStringList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
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
