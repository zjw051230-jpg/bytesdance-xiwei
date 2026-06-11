export async function loadPrDraftCenterContext({ projectId, requirementId, runId } = {}) {
  if (!requirementId) {
    return {
      state: "empty",
      reason: { code: "requirement_missing", message: "Select a requirement to review a PR draft." },
      context: null
    };
  }

  const requirementResult = await requestEnvelopeResult(`/api/requirements/${encodeURIComponent(requirementId)}`);
  if (requirementResult.state !== "success") return emptyAwareResult(requirementResult, "requirement");

  const draftResult = await requestEnvelopeResult(`/api/requirements/${encodeURIComponent(requirementId)}/pr-draft`);
  if (draftResult.state !== "success") return emptyAwareResult(draftResult, "prDraft");

  const prDraft = draftResult.data;
  const effectiveRunId = runId || prDraft?.runId || prDraft?.sourceRun || requirementResult.data?.runId || "";

  const [agentRunResult, reviewResult, artifactResult, activityResult, changesResult] = await Promise.all([
    effectiveRunId ? requestEnvelopeResult(`/api/agent/runs/${encodeURIComponent(effectiveRunId)}`) : unavailableResult("agent_run_missing", "No agent run id was returned for this PR draft."),
    effectiveRunId ? requestEnvelopeResult(`/api/agent/runs/${encodeURIComponent(effectiveRunId)}/review`) : unavailableResult("review_unavailable", "Review data needs an agent run id."),
    effectiveRunId ? requestEnvelopeResult(`/api/agent/runs/${encodeURIComponent(effectiveRunId)}/artifacts`) : unavailableResult("artifacts_unavailable", "Artifact data needs an agent run id."),
    projectId ? requestEnvelopeResult(`/api/projects/${encodeURIComponent(projectId)}/activity`) : unavailableResult("activity_unavailable", "Project id is required for activity."),
    effectiveRunId ? requestEnvelopeResult(`/api/agent/runs/${encodeURIComponent(effectiveRunId)}/changes`) : unavailableResult("changes_unavailable", "Changed-file records need an agent run id.")
  ]);

  return {
    state: "success",
    context: normalizeContext({
      requirement: requirementResult.data,
      prDraft,
      agentRun: dataOrNull(agentRunResult),
      reviewItems: dataOrEmptyArray(reviewResult),
      artifacts: dataOrEmptyArray(artifactResult),
      activity: dataOrEmptyArray(activityResult),
      changeRecords: dataOrNull(changesResult),
      sources: {
        requirement: requirementResult,
        prDraft: draftResult,
        agentRun: agentRunResult,
        review: reviewResult,
        artifacts: artifactResult,
        activity: activityResult,
        changes: changesResult
      }
    })
  };
}

export async function savePrDraft(requirementId, payload) {
  return normalizePrDraft(await requestEnvelope(`/api/requirements/${encodeURIComponent(requirementId)}/pr-draft`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  }));
}

export async function patchPrDraft(prDraftId, payload) {
  return normalizePrDraft(await requestEnvelope(`/api/pr-drafts/${encodeURIComponent(prDraftId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  }));
}

export async function regeneratePrDraft(requirementId, { runId } = {}) {
  return normalizePrDraft(await requestEnvelope(`/api/requirements/${encodeURIComponent(requirementId)}/pr-draft`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ runId, regenerate: true })
  }));
}

export async function requestEnvelopeResult(url, options) {
  try {
    const data = await requestEnvelope(url, options);
    return { state: "success", data, error: null };
  } catch (error) {
    const payload = error.payload || {};
    const code = payload.error?.code || "network_error";
    return {
      state: classifyError(code),
      data: null,
      error: payload.error || { code, message: error.message || "API request failed.", details: {} }
    };
  }
}

export async function requestEnvelope(url, options) {
  let response;
  try {
    response = await fetch(url, options);
  } catch (error) {
    throw envelopeError({
      ok: false,
      data: null,
      error: { code: "network_error", message: `Persistence API unavailable: ${String(error.message || error)}`, details: {} }
    });
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw envelopeError({
      ok: false,
      data: null,
      error: { code: "validation_failed", message: "API returned invalid JSON.", details: { parseError: String(error.message || error) } }
    });
  }

  if (!response.ok || payload?.ok !== true) {
    throw envelopeError(payload?.error ? payload : {
      ok: false,
      data: null,
      error: { code: response.status === 404 ? "not_found" : "validation_failed", message: `API request failed (${response.status || 0})`, details: {} }
    });
  }
  return payload.data;
}

export function normalizeContext(input = {}) {
  const prDraft = normalizePrDraft(input.prDraft || {});
  const requirement = normalizeRequirement(input.requirement || {}, prDraft.requirementId);
  const agentRun = normalizeAgentRun(input.agentRun || {}, prDraft.runId);
  const reviewItems = normalizeReviewItems(input.reviewItems || input.review || []);
  const artifacts = normalizeArtifacts(input.artifacts || []);
  const activity = normalizeActivity(input.activity || []);
  const changeRecords = normalizeChangeRecords(input.changeRecords || {});
  return {
    requirement,
    agentRun,
    prDraft: {
      ...prDraft,
      requirementId: prDraft.requirementId || requirement.id,
      runId: prDraft.runId || agentRun.runId
    },
    reviewItems,
    artifacts,
    activity,
    changeRecords,
    sources: input.sources || {}
  };
}

export function normalizePrDraft(input = {}) {
  return {
    id: input.id || "",
    requirementId: input.requirementId || "",
    runId: input.runId || input.sourceRun || "",
    title: input.title || "",
    summary: normalizeSummary(input.summary),
    changedFiles: normalizeChangedFiles(input.changedFiles || []),
    tests: normalizeTests(input.tests || []),
    risks: normalizeRisks(input.risks || []),
    checklist: normalizeChecklist(input.checklist || input.checklistJson || []),
    notes: input.notes || input.body || "",
    status: input.status || "draft",
    copiedAt: input.copiedAt || null,
    updatedAt: input.updatedAt || null
  };
}

function normalizeRequirement(input, fallbackId = "") {
  const readiness = input.readiness || input.dslReadiness || input.status || "";
  return {
    id: input.id || fallbackId || "",
    projectId: input.projectId || "",
    title: input.title || input.name || "",
    goal: input.goal || input.description || input.user_story || "",
    readiness,
    dslReadiness: input.dslReadiness || readiness,
    handoffDecision: input.handoffDecision || input.handoff_decision || "",
    points: normalizeArray(input.points || input.requirementPoints || input.acceptanceCriteria)
  };
}

function normalizeAgentRun(input, fallbackRunId = "") {
  return {
    id: input.id || input.runId || fallbackRunId || "",
    runId: input.runId || input.id || fallbackRunId || "",
    status: input.status || "",
    summary: input.summary || input.latestReturn || "",
    completedAt: input.completedAt || input.updatedAt || "",
    verificationStatus: input.verificationStatus || ""
  };
}

function normalizeChangedFiles(files) {
  return normalizeArray(files).map((file, index) => {
    if (typeof file === "string") {
      return { id: `file-${index}`, path: file, changeSummary: "", why: "", requirementPoint: "", risk: "", testStatus: "", reviewStatus: "" };
    }
    return {
      id: file.id || `file-${index}`,
      path: file.path || file.file || file.filePath || "",
      changeSummary: file.changeSummary || file.summary || "",
      why: file.why || "",
      requirementPoint: file.requirementPoint || file.requirement || "",
      risk: file.risk || "",
      testStatus: file.testStatus || file.test || "",
      reviewStatus: file.reviewStatus || file.review || file.status || ""
    };
  });
}

function normalizeTests(tests) {
  return normalizeArray(tests).map((test, index) => {
    if (typeof test === "string") return { id: `test-${index}`, name: test, status: "", source: "", required: true, errorSummary: "" };
    return {
      id: test.id || `test-${index}`,
      name: test.name || test.command || `Test ${index + 1}`,
      status: test.status || "",
      source: test.source || test.command || "",
      required: test.required !== false,
      errorSummary: test.errorSummary || test.error || ""
    };
  });
}

function normalizeRisks(risks) {
  return normalizeArray(risks).map((risk, index) => {
    if (typeof risk === "string") return { id: `risk-${index}`, level: "", message: risk, mitigation: "", acknowledged: false };
    return {
      id: risk.id || `risk-${index}`,
      level: risk.level || risk.priority || "",
      message: risk.message || risk.description || "",
      mitigation: risk.mitigation || "",
      acknowledged: Boolean(risk.acknowledged)
    };
  });
}

function normalizeChecklist(items) {
  return normalizeArray(items).map((item, index) => {
    if (typeof item === "string") return { id: `check-${index}`, label: item, checked: false, blocking: false, system: false };
    return {
      id: item.id || `check-${index}`,
      label: item.label || item.text || "",
      checked: Boolean(item.checked),
      blocking: Boolean(item.blocking),
      system: Boolean(item.system)
    };
  });
}

function normalizeSummary(summary) {
  if (Array.isArray(summary)) return summary.filter(Boolean).map(String);
  return String(summary || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function normalizeReviewItems(items) {
  return normalizeArray(items).map((item, index) => ({
    id: item.id || `review-${index}`,
    filePath: item.filePath || item.file || item.path || "",
    status: item.status || item.humanStatus || "",
    required: Boolean(item.required),
    message: item.message || item.summary || ""
  }));
}

function normalizeArtifacts(items) {
  const list = Array.isArray(items) ? items : Array.isArray(items?.artifactList) ? items.artifactList : [];
  return list.map((item, index) => ({
    id: item.id || `artifact-${index}`,
    type: item.type || "",
    name: item.name || item.fileName || `artifact-${index}`,
    contentPreview: isUnsafeArtifact(item) ? "[redacted preview withheld]" : (item.contentPreview || item.preview || item.text || ""),
    redactionState: item.redactionState || item.redaction || "",
    createdAt: item.createdAt || ""
  }));
}

function normalizeActivity(items) {
  return normalizeArray(items).map((item, index) => ({
    id: item.id || `activity-${index}`,
    actor: item.actor || item.source || "",
    action: item.action || item.message || item.title || "",
    createdAt: item.createdAt || item.timestamp || ""
  }));
}

function normalizeChangeRecords(input) {
  const changes = Array.isArray(input?.changes) ? input.changes : [];
  return {
    available: input?.available !== false && !input?.unavailable,
    errorCode: input?.errorCode || "",
    verificationStatus: input?.verificationStatus || "",
    changes: changes.map((change, index) => ({
      id: change.id || `change-${index}`,
      filePath: change.filePath || change.path || change.file || "",
      status: change.status || "",
      changeType: change.changeType || ""
    }))
  };
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function dataOrEmptyArray(result) {
  return result.state === "success" ? result.data : [];
}

function dataOrNull(result) {
  return result.state === "success" ? result.data : null;
}

function unavailableResult(code, message) {
  return { state: "unavailable", data: null, error: { code, message, details: {} } };
}

function emptyAwareResult(result, resource) {
  if (result.state === "empty") {
    return { state: "empty", reason: result.error, resource, context: null };
  }
  return { state: result.state, error: result.error, resource, context: null };
}

function classifyError(code) {
  if (code === "pr_draft_not_found") return "empty";
  if (code === "network_error" || code === "not_found" || String(code).endsWith("_not_found")) return "unavailable";
  return "error";
}

function isUnsafeArtifact(item = {}) {
  const state = item.redactionState || item.redaction;
  const name = String(item.name || item.fileName || "").toLowerCase();
  return ["redacted", "unsafe", "secret_redacted"].includes(state) || name.includes(".env") || name.includes("token") || name.includes("secret") || name.includes("full_sandbox_log") || name.includes("full_patch_diff");
}

function envelopeError(payload) {
  const error = new Error(payload?.error?.message || "PR draft API request failed");
  error.payload = payload;
  return error;
}
