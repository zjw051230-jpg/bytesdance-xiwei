import { getMockPrDraftContext, regenerateMockPrDraft } from "../mocks/prDraftMock.js";

const FALLBACK_CODES = new Set(["network_error", "not_found", "pr_draft_not_found", "artifact_missing"]);

export async function loadPrDraftCenterContext({ projectId, requirementId, runId } = {}) {
  const targetRequirementId = requirementId || "req-pr-draft-center";
  try {
    const [prDraft, requirement] = await Promise.all([
      requestEnvelope(`/api/requirements/${encodeURIComponent(targetRequirementId)}/pr-draft`),
      requestEnvelope(`/api/requirements/${encodeURIComponent(targetRequirementId)}`)
    ]);
    const effectiveRunId = runId || prDraft?.runId || prDraft?.sourceRun || requirement?.runId;
    const [agentRun, reviewItems, artifacts, activity] = await Promise.all([
      effectiveRunId ? requestEnvelope(`/api/agent/runs/${encodeURIComponent(effectiveRunId)}`) : Promise.resolve(null),
      effectiveRunId ? requestEnvelope(`/api/agent/runs/${encodeURIComponent(effectiveRunId)}/review`) : Promise.resolve([]),
      effectiveRunId ? requestEnvelope(`/api/agent/runs/${encodeURIComponent(effectiveRunId)}/artifacts`) : Promise.resolve([]),
      projectId ? requestEnvelope(`/api/projects/${encodeURIComponent(projectId)}/activity`) : Promise.resolve([])
    ]);
    const changeRecords = effectiveRunId
      ? await requestEnvelope(`/api/agent/runs/${encodeURIComponent(effectiveRunId)}/changes`).catch((error) => ({
        unavailable: true,
        errorCode: error.payload?.error?.code || "changes_unavailable",
        changes: [],
        verificationStatus: agentRun?.verificationStatus || "unknown"
      }))
      : null;
    return normalizeContext({ requirement, prDraft, agentRun, reviewItems, artifacts, activity, changeRecords, usedMockFallback: false });
  } catch (error) {
    if (!shouldUseFallback(error)) throw error;
    return normalizeContext({ ...getMockPrDraftContext(targetRequirementId), usedMockFallback: true, fallbackReason: error.payload?.error || { code: "network_error", message: error.message } });
  }
}

export async function savePrDraft(requirementId, payload) {
  try {
    return normalizePrDraft(await requestEnvelope(`/api/requirements/${encodeURIComponent(requirementId)}/pr-draft`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    }));
  } catch (error) {
    if (!shouldUseFallback(error)) throw error;
    return normalizePrDraft({ ...payload, id: payload.id || `mock-saved-${Date.now()}`, requirementId, updatedAt: new Date().toISOString() });
  }
}

export async function patchPrDraft(prDraftId, payload) {
  try {
    return normalizePrDraft(await requestEnvelope(`/api/pr-drafts/${encodeURIComponent(prDraftId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    }));
  } catch (error) {
    if (!shouldUseFallback(error)) throw error;
    return normalizePrDraft({ ...payload, id: prDraftId, updatedAt: new Date().toISOString() });
  }
}

export async function regeneratePrDraft(requirementId, { runId } = {}) {
  try {
    return normalizePrDraft(await requestEnvelope(`/api/requirements/${encodeURIComponent(requirementId)}/pr-draft`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId, regenerate: true })
    }));
  } catch (error) {
    if (!shouldUseFallback(error)) throw error;
    return normalizePrDraft(regenerateMockPrDraft(requirementId, runId));
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
    usedMockFallback: Boolean(input.usedMockFallback),
    fallbackReason: input.fallbackReason || null
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
  const readiness = input.readiness || input.dslReadiness || input.status || "missing";
  return {
    id: input.id || fallbackId || "req-pr-draft-center",
    projectId: input.projectId || "",
    title: input.title || input.name || "Untitled requirement",
    goal: input.goal || input.description || input.user_story || "No requirement goal was provided.",
    readiness,
    dslReadiness: input.dslReadiness || readiness,
    handoffDecision: input.handoffDecision || input.handoff_decision || "not_recorded",
    points: input.points || input.requirementPoints || input.acceptanceCriteria || []
  };
}

function normalizeAgentRun(input, fallbackRunId = "") {
  return {
    id: input.id || input.runId || fallbackRunId || "",
    runId: input.runId || input.id || fallbackRunId || "",
    status: input.status || "missing",
    summary: input.summary || input.latestReturn || "",
    completedAt: input.completedAt || input.updatedAt || "",
    verificationStatus: input.verificationStatus || "unknown"
  };
}

function normalizeChangedFiles(files) {
  return files.map((file, index) => {
    if (typeof file === "string") {
      return { id: `file-${index}`, path: file, changeSummary: "Changed file recorded by agent run.", why: "Mapped from draft evidence.", requirementPoint: "Unmapped", risk: "Not documented", testStatus: "missing", reviewStatus: "pending" };
    }
    return {
      id: file.id || `file-${index}`,
      path: file.path || file.file || file.filePath || "unknown-file",
      changeSummary: file.changeSummary || file.summary || "No change summary recorded.",
      why: file.why || "No rationale recorded.",
      requirementPoint: file.requirementPoint || file.requirement || "Unmapped",
      risk: file.risk || "No risk recorded.",
      testStatus: file.testStatus || file.test || "missing",
      reviewStatus: file.reviewStatus || file.review || file.status || "pending"
    };
  });
}

function normalizeTests(tests) {
  return tests.map((test, index) => {
    if (typeof test === "string") return { id: `test-${index}`, name: test, status: "planned", source: "manual", required: true, errorSummary: "" };
    return {
      id: test.id || `test-${index}`,
      name: test.name || test.command || `Test ${index + 1}`,
      status: test.status || "missing",
      source: test.source || test.command || "unknown",
      required: test.required !== false,
      errorSummary: test.errorSummary || test.error || ""
    };
  });
}

function normalizeRisks(risks) {
  return risks.map((risk, index) => {
    if (typeof risk === "string") return { id: `risk-${index}`, level: "medium", message: risk, mitigation: "Document before ready.", acknowledged: false };
    return {
      id: risk.id || `risk-${index}`,
      level: risk.level || risk.priority || "medium",
      message: risk.message || risk.description || "No risk message recorded.",
      mitigation: risk.mitigation || "No mitigation recorded.",
      acknowledged: Boolean(risk.acknowledged)
    };
  });
}

function normalizeChecklist(items) {
  return items.map((item, index) => {
    if (typeof item === "string") return { id: `check-${index}`, label: item, checked: false, blocking: false, system: false };
    return {
      id: item.id || `check-${index}`,
      label: item.label || item.text || "Checklist item",
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
  if (!Array.isArray(items)) return [];
  return items.map((item, index) => ({
    id: item.id || `review-${index}`,
    filePath: item.filePath || item.file || item.path || "general",
    status: item.status || item.humanStatus || "pending",
    required: Boolean(item.required),
    message: item.message || item.summary || "No review detail recorded."
  }));
}

function normalizeArtifacts(items) {
  const list = Array.isArray(items) ? items : Object.entries(items).map(([name, value]) => ({ name, ...(value || {}) }));
  return list.map((item, index) => ({
    id: item.id || `artifact-${index}`,
    type: item.type || "artifact",
    name: item.name || `artifact-${index}`,
    contentPreview: isUnsafeArtifact(item) ? "[redacted preview withheld]" : (item.contentPreview || item.preview || item.text || "No preview recorded."),
    redactionState: item.redactionState || item.redaction || "safe",
    createdAt: item.createdAt || ""
  }));
}

function normalizeActivity(items) {
  if (!Array.isArray(items)) return [];
  return items.map((item, index) => ({
    id: item.id || `activity-${index}`,
    actor: item.actor || item.source || "System",
    action: item.action || item.message || item.title || "Activity recorded",
    createdAt: item.createdAt || item.timestamp || ""
  }));
}

function normalizeChangeRecords(input) {
  const changes = Array.isArray(input.changes) ? input.changes : [];
  return {
    available: input.available !== false && !input.unavailable,
    errorCode: input.errorCode || "",
    verificationStatus: input.verificationStatus || "unknown",
    changes: changes.map((change, index) => ({
      id: change.id || `change-${index}`,
      filePath: change.filePath || change.path || change.file || "unknown-file",
      status: change.status || "changed",
      changeType: change.changeType || "modified"
    }))
  };
}

function isUnsafeArtifact(item = {}) {
  const state = item.redactionState || item.redaction;
  const name = String(item.name || "").toLowerCase();
  return ["redacted", "unsafe", "secret_redacted"].includes(state) || name.includes(".env") || name.includes("token") || name.includes("secret") || name.includes("full_sandbox_log") || name.includes("full_patch_diff");
}

function shouldUseFallback(error) {
  const code = error?.payload?.error?.code;
  return !code || FALLBACK_CODES.has(code) || code === "network_error" || String(code).endsWith("_not_found");
}

function envelopeError(payload) {
  const error = new Error(payload?.error?.message || "PR draft API request failed");
  error.payload = payload;
  return error;
}
