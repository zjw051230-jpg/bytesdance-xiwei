import { CopyWorkspaceAdapter } from "./workspaceAdapter.js";

export async function listRunChanges(service, runId) {
  const run = service.agentRuns.get(runId);
  if (!run) return errorResult("agent_run_not_found", "Agent run not found", { runId }, 404);
  const snapshot = service.workspaceSnapshots.getBaseline(runId);
  const changes = service.fileChangeRecords.listByRun(runId);
  const rollbacks = service.rollbackOperations.listByRun(runId);
  return {
    ok: true,
    data: {
      runId,
      available: Boolean(snapshot),
      reason: snapshot ? "" : "workspace_not_initialized",
      verificationStatus: run.verificationStatus || "unknown",
      sourceRepoPath: run.sourceRepoPath || "",
      workspacePath: run.workspacePath || "",
      baselineSnapshot: snapshot,
      changes: changes.map((change) => ({
        ...change,
        canRevert: Boolean(snapshot) && ["changed", "needs_change", "approved"].includes(change.status)
      })),
      rollbackHistory: rollbacks
    },
    error: null
  };
}

export async function getRunChangeDiff(service, runId, changeId, options = {}) {
  const prepared = getRollbackContext(service, runId, changeId);
  if (!prepared.ok) return prepared;
  const adapter = adapterFor(prepared.data.snapshot, options);
  try {
    const diff = await adapter.getFileDiff({
      workspacePath: prepared.data.snapshot.workspacePath,
      baselinePath: prepared.data.snapshot.baselinePath,
      filePath: prepared.data.change.filePath
    });
    return { ok: true, data: { runId, changeId, ...diff }, error: null };
  } catch (error) {
    return errorResult(error.code || "diff_failed", "Could not read file diff.", { reason: String(error.message || error) }, 400);
  }
}

export async function revertRunFile(service, runId, body = {}, options = {}) {
  const prepared = getRollbackContext(service, runId, body.changeId);
  if (!prepared.ok) return prepared;
  const { run, snapshot, change } = prepared.data;
  const adapter = adapterFor(snapshot, options);
  try {
    const reverted = await adapter.revertFile({
      workspacePath: snapshot.workspacePath,
      baselinePath: snapshot.baselinePath,
      filePath: change.filePath
    });
    const updatedChange = service.fileChangeRecords.update(change.id, { status: "reverted" });
    const relatedReview = service.reviewItems.listByRun(runId).filter((item) => item.filePath === change.filePath);
    for (const item of relatedReview) {
      service.reviewItems.update(item.id, {
        humanStatus: "reverted",
        humanComment: body.reason || "File reverted to run baseline."
      });
      service.activity.create(activityFor(run, "REVIEW_ITEM_STATUS_CHANGED", `Review item reverted for ${change.filePath}.`, {
        reviewItemId: item.id,
        filePath: change.filePath,
        humanStatus: "reverted"
      }));
    }
    const operation = service.rollbackOperations.create(runId, {
      changeId: change.id,
      operationType: "file_revert",
      reason: body.reason || "",
      files: [change.filePath]
    });
    invalidateVerification(service, run, "PATCH_FILE_REVERTED", `Reverted ${change.filePath} to run baseline.`, {
      operationId: operation.id,
      filePath: change.filePath,
      reverted
    });
    return {
      ok: true,
      data: {
        runId,
        change: updatedChange,
        operation,
        verificationStatus: "stale"
      },
      error: null
    };
  } catch (error) {
    const operation = service.rollbackOperations.create(runId, {
      changeId: change.id,
      operationType: "file_revert",
      status: "failed",
      reason: body.reason || "",
      files: [change.filePath],
      errorMessage: String(error.message || error)
    });
    return errorResult(error.code || "rollback_failed", "File rollback failed.", { operationId: operation.id, reason: String(error.message || error) }, 400);
  }
}

export async function resetRunWorkspace(service, runId, body = {}, options = {}) {
  const run = service.agentRuns.get(runId);
  if (!run) return errorResult("agent_run_not_found", "Agent run not found", { runId }, 404);
  const snapshot = service.workspaceSnapshots.getBaseline(runId);
  if (!snapshot) return workspaceMissing(runId);
  const changes = service.fileChangeRecords.listByRun(runId);
  const adapter = adapterFor(snapshot, options);
  try {
    await adapter.resetRunWorkspace({
      workspacePath: snapshot.workspacePath,
      baselinePath: snapshot.baselinePath
    });
    const updatedChanges = service.fileChangeRecords.markRunReset(runId);
    for (const item of service.reviewItems.listByRun(runId)) {
      service.reviewItems.update(item.id, {
        humanStatus: "reverted",
        humanComment: body.reason || "Run workspace reset to baseline."
      });
    }
    const operation = service.rollbackOperations.create(runId, {
      operationType: "run_reset",
      reason: body.reason || "",
      files: changes.map((change) => change.filePath)
    });
    invalidateVerification(service, run, "PATCH_RUN_RESET", "Run workspace reset to baseline.", {
      operationId: operation.id,
      files: changes.map((change) => change.filePath)
    });
    return {
      ok: true,
      data: {
        runId,
        changes: updatedChanges,
        operation,
        verificationStatus: "stale"
      },
      error: null
    };
  } catch (error) {
    const operation = service.rollbackOperations.create(runId, {
      operationType: "run_reset",
      status: "failed",
      reason: body.reason || "",
      files: changes.map((change) => change.filePath),
      errorMessage: String(error.message || error)
    });
    return errorResult(error.code || "rollback_failed", "Run reset failed.", { operationId: operation.id, reason: String(error.message || error) }, 400);
  }
}

export async function createRunCheckpoint(service, runId, body = {}, options = {}) {
  const run = service.agentRuns.get(runId);
  if (!run) return errorResult("agent_run_not_found", "Agent run not found", { runId }, 404);
  const snapshot = service.workspaceSnapshots.getBaseline(runId);
  if (!snapshot) return workspaceMissing(runId);
  const adapter = adapterFor(snapshot, options);
  try {
    const checkpoint = await adapter.createCheckpoint({
      runId,
      workspacePath: snapshot.workspacePath,
      label: body.label || "manual"
    });
    const record = service.workspaceSnapshots.create(runId, {
      id: `checkpoint-${runId}-${Date.now()}`,
      snapshotType: "checkpoint",
      sourceRepoPath: snapshot.sourceRepoPath,
      workspacePath: snapshot.workspacePath,
      baselinePath: checkpoint.checkpointPath,
      adapterType: snapshot.adapterType,
      metadataJson: { label: body.label || "manual", reason: body.reason || "" }
    });
    service.activity.create(activityFor(run, "WORKSPACE_SNAPSHOT_CREATED", "Workspace checkpoint created.", {
      checkpointId: record.id,
      label: body.label || "manual"
    }));
    return { ok: true, data: record, error: null };
  } catch (error) {
    return errorResult(error.code || "checkpoint_failed", "Checkpoint creation failed.", { reason: String(error.message || error) }, 400);
  }
}

function getRollbackContext(service, runId, changeId) {
  const run = service.agentRuns.get(runId);
  if (!run) return errorResult("agent_run_not_found", "Agent run not found", { runId }, 404);
  const snapshot = service.workspaceSnapshots.getBaseline(runId);
  if (!snapshot) return workspaceMissing(runId);
  const change = service.fileChangeRecords.get(changeId);
  if (!change || change.runId !== runId) {
    return errorResult("change_not_found", "File change record not found for this run.", { runId, changeId }, 404);
  }
  return { ok: true, data: { run, snapshot, change }, error: null };
}

function invalidateVerification(service, run, eventType, message, payloadJson = {}) {
  service.agentRuns.update(run.id, { verificationStatus: "stale" });
  service.activity.create(activityFor(run, eventType, message, payloadJson));
  service.activity.create(activityFor(run, "ROLLBACK_COMPLETED", "Rollback operation completed.", payloadJson));
  service.activity.create(activityFor(run, "VERIFICATION_INVALIDATED", "Verification is stale after rollback.", {
    reason: eventType
  }));
}

function activityFor(run, type, message, payloadJson = {}) {
  return {
    projectId: run.contextSnapshot?.projectId || run.contextSnapshot?.project_id || null,
    requirementId: run.requirementId || null,
    runId: run.id,
    type,
    level: type === "VERIFICATION_INVALIDATED" ? "warn" : "info",
    message,
    payloadJson
  };
}

function adapterFor(snapshot, options = {}) {
  if (options.workspaceAdapter) return options.workspaceAdapter;
  return new CopyWorkspaceAdapter({ runsRoot: options.runsRoot || "runs", adapterType: snapshot.adapterType });
}

function workspaceMissing(runId) {
  return errorResult("workspace_not_initialized", "This Agent Run has no baseline workspace snapshot.", { runId }, 409);
}

function errorResult(code, message, details = {}, status = 400) {
  return {
    ok: false,
    status,
    data: null,
    error: { code, message, details }
  };
}
