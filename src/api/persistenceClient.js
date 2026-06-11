import { logSlowRequest, markRequestStart } from "./performance.js";

export async function listProjects() {
  return requestJson("/api/projects");
}

export async function createProject(payload) {
  return requestJson("/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export async function updateProject(projectId, payload) {
  return requestJson(`/api/projects/${encodeURIComponent(projectId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export async function deleteProject(projectId) {
  return requestJson(`/api/projects/${encodeURIComponent(projectId)}`, {
    method: "DELETE"
  });
}

export async function listRequirements(projectId) {
  return requestJson(`/api/projects/${encodeURIComponent(projectId)}/requirements`);
}

export async function createRequirement(projectId, payload) {
  return postJson(`/api/projects/${encodeURIComponent(projectId)}/requirements`, payload);
}

export async function getRequirement(requirementId) {
  return requestJson(`/api/requirements/${encodeURIComponent(requirementId)}`);
}

export async function updateRequirement(requirementId, payload) {
  return patchJson(`/api/requirements/${encodeURIComponent(requirementId)}`, payload);
}

export async function listClarifications(requirementId) {
  return requestJson(`/api/requirements/${encodeURIComponent(requirementId)}/clarifications`);
}

export async function createClarification(requirementId, payload) {
  return postJson(`/api/requirements/${encodeURIComponent(requirementId)}/clarifications`, payload);
}

export async function getDesignPlan(requirementId) {
  return requestJson(`/api/requirements/${encodeURIComponent(requirementId)}/design-plan`);
}

export async function upsertDesignPlan(requirementId, payload) {
  return postJson(`/api/requirements/${encodeURIComponent(requirementId)}/design-plan`, payload);
}

export async function listPlanningTasks(planId) {
  return requestJson(`/api/design-plans/${encodeURIComponent(planId)}/tasks`);
}

export async function createPlanningTask(planId, payload) {
  return postJson(`/api/design-plans/${encodeURIComponent(planId)}/tasks`, payload);
}

export async function updatePlanningTask(taskId, payload) {
  return patchJson(`/api/planning-tasks/${encodeURIComponent(taskId)}`, payload);
}

export async function getPersistentAgentRun(runId) {
  return requestJson(`/api/agent/runs/${encodeURIComponent(runId)}`);
}

export async function listAgentArtifacts(runId) {
  return requestJson(`/api/agent/runs/${encodeURIComponent(runId)}/artifacts`);
}

export async function listProjectActivity(projectId) {
  return requestJson(`/api/projects/${encodeURIComponent(projectId)}/activity`);
}

export async function listReviewItems(runId) {
  return requestJson(`/api/agent/runs/${encodeURIComponent(runId)}/review`);
}

export async function listAgentRunChanges(runId) {
  return requestJson(`/api/agent/runs/${encodeURIComponent(runId)}/changes`);
}

export async function getAgentRunChangeDiff(runId, changeId) {
  return requestJson(`/api/agent/runs/${encodeURIComponent(runId)}/changes/${encodeURIComponent(changeId)}/diff`);
}

export async function revertAgentRunFile(runId, payload) {
  return postJson(`/api/agent/runs/${encodeURIComponent(runId)}/rollback/file`, payload);
}

export async function resetAgentRunWorkspace(runId, payload) {
  return postJson(`/api/agent/runs/${encodeURIComponent(runId)}/rollback`, payload);
}

export async function applyAgentRunToSource(runId, payload) {
  return postJson(`/api/agent/runs/${encodeURIComponent(runId)}/apply`, payload);
}

export async function createAgentRunCheckpoint(runId, payload) {
  return postJson(`/api/agent/runs/${encodeURIComponent(runId)}/checkpoints`, payload);
}

export async function updateReviewItem(reviewItemId, payload) {
  return patchJson(`/api/review-items/${encodeURIComponent(reviewItemId)}`, payload);
}

export async function getPrDraft(requirementId) {
  return requestJson(`/api/requirements/${encodeURIComponent(requirementId)}/pr-draft`);
}

export async function upsertPrDraft(requirementId, payload) {
  return postJson(`/api/requirements/${encodeURIComponent(requirementId)}/pr-draft`, payload);
}

export async function updatePrDraft(prDraftId, payload) {
  return patchJson(`/api/pr-drafts/${encodeURIComponent(prDraftId)}`, payload);
}

function postJson(url, payload) {
  return requestJson(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
}

function patchJson(url, payload) {
  return requestJson(url, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
}

async function requestJson(url, options) {
  const startedAt = markRequestStart();
  let response;
  try {
    response = await fetch(url, options);
  } catch (error) {
    throw payloadError({
      ok: false,
      data: null,
      error: {
        code: "network_error",
        message: `Persistence API unavailable: ${String(error.message || error)}`,
        details: {}
      }
    });
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw payloadError({
      ok: false,
      data: null,
      error: {
        code: "invalid_json_response",
        message: `Persistence API returned invalid JSON (${response.status || 0} ${response.statusText || ""})`.trim(),
        details: { parseError: String(error.message || error) }
      }
    });
  }

  logSlowRequest(url, startedAt, options);

  if (!response.ok || payload?.ok !== true) {
    throw payloadError(payload?.error ? payload : {
      ok: false,
      data: null,
      error: {
        code: "request_failed",
        message: `Persistence API request failed (${response.status || 0} ${response.statusText || ""})`.trim(),
        details: {}
      }
    });
  }
  return payload.data;
}

function payloadError(payload) {
  const error = new Error(payload?.error?.message || "Persistence API request failed");
  error.payload = payload;
  return error;
}
