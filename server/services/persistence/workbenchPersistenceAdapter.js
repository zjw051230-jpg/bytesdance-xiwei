import { openWorkbenchDatabase } from "../../db/connection.js";
import { migrateDatabase } from "../../db/migrate.js";
import { seedWorkbenchDatabase } from "../../db/seed.js";
import { createPersistenceService } from "./persistenceService.js";

export function withPersistence(config = {}, callback) {
  const database = openWorkbenchDatabase({ dbPath: config.workbenchDbPath });
  try {
    migrateDatabase(database);
    seedWorkbenchDatabase(database);
    return callback(createPersistenceService(database));
  } finally {
    database.close();
  }
}

export function persistDslRunStarted(context = {}) {
  return guardedPersist(context.config, (service) => {
    const projectId = context.projectId || "conduit-realworld-example-app";
    ensureProject(service, projectId);
    const title = inferRequirementTitle(context.pmMessages);
    const requirement = service.requirements.create(projectId, {
      id: `req-${context.runId}`,
      title,
      rawPmInput: mergePmMessages(context.pmMessages),
      readinessStatus: "running",
      readyForAgent: false,
      handoffDecision: "clarify_first",
      completionPercent: 0
    });
    for (const message of context.pmMessages || []) {
      service.clarifications.create(requirement.id, {
        role: normalizeRole(message.role),
        content: message.content || message.text || "",
        source: "dsl_run"
      });
    }
    service.agentRuns.create({
      id: context.runId,
      requirementId: requirement.id,
      status: "running",
      dryRun: true,
      realWritePerformed: false,
      targetRepoPath: "",
      contextSnapshot: { projectId, source: "dsl_artifact_runner" },
      planJson: {},
      resultSummary: "Standalone DSL artifacts running."
    });
    service.activity.create({
      projectId,
      requirementId: requirement.id,
      runId: context.runId,
      type: "dsl_run_started",
      level: "info",
      message: "DSL artifact run started.",
      payloadJson: { runId: context.runId }
    });
    return requirement.id;
  });
}

export function persistDslRunFinished(context = {}) {
  return guardedPersist(context.config, (service) => {
    const requirementId = `req-${context.runId}`;
    service.requirements.update(requirementId, {
      dslJson: context.dslJson || {},
      readinessStatus: context.status || "passed",
      readyForAgent: Boolean(context.uiState?.readiness?.ready_for_agent),
      handoffDecision: context.uiState?.readiness?.handoff_decision || "clarify_first",
      sourceProvider: context.sourceProvider || "",
      sourceModel: context.sourceModel || "",
      completionPercent: context.uiState?.dslCompletion?.value ?? 0
    });
    service.agentRuns.update(context.runId, {
      status: context.status || "completed",
      realWritePerformed: false,
      resultSummary: "DSL artifacts generated.",
      finishedAt: new Date().toISOString()
    });
    for (const artifact of context.artifacts || []) {
      service.agentArtifacts.create(context.runId, artifact);
    }
    service.activity.create({
      projectId: context.projectId || "conduit-realworld-example-app",
      requirementId,
      runId: context.runId,
      type: "dsl_run_finished",
      level: context.status === "passed" ? "info" : "warn",
      message: `DSL artifact run finished with ${context.status || "completed"}.`,
      payloadJson: { artifactStatus: context.artifactStatus || "done" }
    });
  });
}

export function persistDslRunFailed(context = {}) {
  return guardedPersist(context.config, (service) => {
    const requirementId = `req-${context.runId}`;
    service.requirements.update(requirementId, {
      readinessStatus: "failed",
      handoffDecision: "clarify_first"
    });
    service.agentRuns.update(context.runId, {
      status: context.status || "failed",
      errorCode: context.error?.code || "runner_failed",
      errorMessage: context.error?.message || "DSL artifact run failed.",
      finishedAt: new Date().toISOString()
    });
    service.activity.create({
      projectId: context.projectId || "conduit-realworld-example-app",
      requirementId,
      runId: context.runId,
      type: "dsl_run_failed",
      level: "error",
      message: context.error?.message || "DSL artifact run failed.",
      payloadJson: { code: context.error?.code || "runner_failed" }
    });
  });
}

export function persistAgentDryRun(run = {}, config = {}) {
  return guardedPersist(config, (service) => {
    const projectId = run.context?.projectId || "conduit-realworld-example-app";
    ensureProject(service, projectId);
    const requirementId = run.context?.requirementId || `req-agent-${run.runId}`;
    if (!service.requirements.get(requirementId)) {
      service.requirements.create(projectId, {
        id: requirementId,
        title: run.context?.requirementDsl?.title || run.context?.taskTitle || "Agent dry-run requirement",
        rawPmInput: run.context?.taskTitle || "",
        dslJson: run.context?.requirementDsl || {},
        readinessStatus: "clarify_first",
        readyForAgent: false,
        handoffDecision: "clarify_first",
        completionPercent: 0
      });
    }
    service.agentRuns.create({
      id: run.runId,
      requirementId,
      status: run.status,
      dryRun: run.dryRun,
      realWritePerformed: run.realWritePerformed,
      targetRepoPath: run.context?.targetRepoPath || "",
      contextSnapshot: run.context || {},
      planJson: run.plan || {},
      resultSummary: run.latestReturn || "",
      startedAt: run.startedAt,
      finishedAt: run.finishedAt
    });
    for (const [name, artifact] of Object.entries(run.artifacts || {})) {
      service.agentArtifacts.create(run.runId, {
        type: artifactTypeFromName(name),
        name,
        path: artifact.path || "",
        summary: `${name} artifact index`
      });
    }
    for (const file of run.review?.changedFiles || []) {
      service.reviewItems.create(run.runId, {
        filePath: file.file,
        changeSummary: file.changeSummary,
        reason: file.why,
        requirementMapping: file.requirementPoint,
        riskLevel: file.risk ? "P1" : "P2",
        testStatus: "pending",
        humanStatus: "pending"
      });
    }
    if (run.prDraft) {
      service.prDrafts.upsert(requirementId, {
        runId: run.runId,
        title: run.prDraft.title,
        summary: Array.isArray(run.prDraft.summary) ? run.prDraft.summary.join("\n") : run.prDraft.summary,
        body: run.prDraft.body || "",
        checklistJson: run.prDraft.checklist || [],
        status: "draft"
      });
    }
    service.activity.create({
      projectId,
      requirementId,
      runId: run.runId,
      type: "agent_dry_run_completed",
      level: "info",
      message: run.latestReturn || "Agent dry-run completed.",
      payloadJson: { realWritePerformed: run.realWritePerformed }
    });
  });
}

function guardedPersist(config, callback) {
  try {
    return withPersistence(config, callback);
  } catch {
    return null;
  }
}

function ensureProject(service, projectId) {
  if (service.projects.get(projectId)) return;
  service.projects.create({
    id: projectId,
    name: projectId,
    description: "Persisted workbench project",
    status: "current"
  });
}

function inferRequirementTitle(messages = []) {
  const text = [...messages].reverse().find((message) => message.role === "pm")?.content || "Workbench requirement";
  return text.slice(0, 80);
}

function mergePmMessages(messages = []) {
  return messages.map((message) => `${message.role}: ${message.content || message.text || ""}`).join("\n\n");
}

function normalizeRole(role) {
  if (role === "assistant") return "assistant";
  if (role === "system") return "system";
  return "pm";
}

function artifactTypeFromName(name) {
  if (name.includes("context")) return "context";
  if (name.includes("review")) return "report";
  if (name.includes("pr")) return "pr_summary";
  if (name.includes("plan")) return "report";
  return "report";
}
