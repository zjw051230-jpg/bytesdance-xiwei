const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { EventStore, stableStringify } = require("./eventStore");
const { RedactionManifestStore, applyRedactionOverlay } = require("./redactionManifest");

const PROJECTOR_VERSION = "trace-projector-v1";

const LEGAL_STATUS_TRANSITIONS = new Set([
  "created->active",
  "created->verified",
  "created->failed",
  "created->invalidated",
  "created->superseded",
  "created->archived",
  "active->verified",
  "active->failed",
  "active->invalidated",
  "active->superseded",
  "active->archived",
  "failed->archived",
  "failed->superseded",
  "verified->superseded",
  "verified->invalidated",
  "verified->archived",
  "invalidated->archived",
  "superseded->archived",
  "redacted->archived",
]);

class TraceProjector {
  constructor({ eventStore, redactionManifestStore, storageRoot, projectorVersion, now } = {}) {
    this.eventStore = eventStore || new EventStore({ storageRoot });
    this.redactionManifestStore = redactionManifestStore || new RedactionManifestStore({ storageRoot: storageRoot || this.eventStore.storageRoot });
    this.storageRoot = storageRoot || this.eventStore.storageRoot;
    this.projectorVersion = projectorVersion || PROJECTOR_VERSION;
    this.now = now || (() => new Date().toISOString());
  }

  rebuildTraceView(taskId) {
    const rawEvents = this.eventStore.readEvents(taskId);
    const redactionManifests = this.redactionManifestStore.readRedactionManifests(taskId);
    const events = applyRedactionOverlay(rawEvents, redactionManifests);
    const traceView = createEmptyTraceView({
      taskId,
      projectorVersion: this.projectorVersion,
      events,
      generatedAt: this.now(),
      redactionManifests,
    });
    const projectionReport = createProjectionReport(redactionManifests);

    for (const event of events) {
      const result = this.applyEventToTraceView(traceView, event);
      traceView.nodes = result.traceView.nodes;
      traceView.edges = result.traceView.edges;
      traceView.metadata = result.traceView.metadata;
      projectionReport.errors.push(...result.projectionErrors);
      projectionReport.skipped_events.push(...result.skippedEvents);
    }

    traceView.view_hash = hashStable(stripVolatileTraceViewFields(traceView));
    projectionReport.deterministic_hash = traceView.view_hash;
    this.writeProjection(taskId, traceView, projectionReport);
    return { trace_view: traceView, projection_report: projectionReport };
  }

  applyEventToTraceView(traceView, event) {
    const nextTraceView = clone(traceView);
    const projectionErrors = [];
    const skippedEvents = [];

    try {
      if (event.type === "TRACE_NODE_APPENDED") {
        const node = normalizeNodePayload(event);
        const result = appendNode(nextTraceView, event, {
          status: "created",
          created_at: event.created_at,
          ...node,
          task_id: node?.task_id || event.task_id,
        }, "TRACE_NODE_APPENDED requires a node id.");
        return result || { traceView: nextTraceView, projectionErrors, skippedEvents };
      }

      if (event.type === "TRACE_EDGE_APPENDED") {
        const edge = normalizeEdgePayload(event);
        const result = appendEdge(nextTraceView, event, {
          confidence: "deterministic",
          created_at: event.created_at,
          ...edge,
          task_id: edge?.task_id || event.task_id,
        });
        return result || { traceView: nextTraceView, projectionErrors, skippedEvents };
      }

      if (event.type === "TRACE_NODE_STATUS_CHANGED") {
        const statusChange = normalizeStatusPayload(event);
        const result = applyNodeStatus(nextTraceView, event, statusChange.node_id, statusChange.status);
        return result || { traceView: nextTraceView, projectionErrors, skippedEvents };
      }

      if (event.type === "TASK_CREATED") {
        ensureMetadata(nextTraceView);
        nextTraceView.metadata.task_created = true;
        nextTraceView.metadata.task = sanitizeMetadata({
          task_id: event.task_id,
          summary: event.payload?.summary,
          requirement: event.payload?.requirement,
          created_at: event.created_at,
          producer: event.producer,
        });
        return { traceView: nextTraceView, projectionErrors, skippedEvents };
      }

      const domainResult = applyDomainEventToTraceView(nextTraceView, event);
      if (domainResult) {
        return domainResult;
      }

      return {
        traceView: nextTraceView,
        projectionErrors: [buildProjectionError(event, "unsupported_event_type", `Unsupported event type "${event.type}".`, "warning")],
        skippedEvents: [event.event_id],
      };
    } catch (error) {
      return {
        traceView,
        projectionErrors: [buildProjectionError(event, "projection_exception", error.message, "error")],
        skippedEvents: [event.event_id],
      };
    }
  }

  getTraceView(taskId) {
    const filePath = this.traceViewFilePath(taskId);
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    }
    return this.rebuildTraceView(taskId).trace_view;
  }

  writeProjection(taskId, traceView, projectionReport) {
    const taskDirectory = this.taskDirectory(taskId);
    fs.mkdirSync(taskDirectory, { recursive: true });
    fs.writeFileSync(this.traceViewFilePath(taskId), JSON.stringify(traceView, null, 2), "utf8");
    fs.writeFileSync(this.projectionReportFilePath(taskId), JSON.stringify(projectionReport, null, 2), "utf8");
  }

  traceViewFilePath(taskId) {
    return path.join(this.taskDirectory(taskId), "trace_view.json");
  }

  projectionReportFilePath(taskId) {
    return path.join(this.taskDirectory(taskId), "projection_report.json");
  }

  taskDirectory(taskId) {
    return path.join(this.storageRoot, "tasks", safePathSegment(taskId));
  }
}

function createEmptyTraceView({ taskId, projectorVersion, events, generatedAt, redactionManifests = [] }) {
  const redactionManifestIds = redactionManifests.map((manifest) => manifest.manifest_id);
  return {
    task_id: taskId,
    projector_version: projectorVersion,
    source_event_count: events.length,
    source_last_seq: events.reduce((latest, event) => Math.max(latest, Number(event.seq || 0)), 0),
    events_hash: hashStable(events),
    view_hash: "",
    generated_at: generatedAt,
    nodes: [],
    edges: [],
    metadata: {
      redaction_manifest_ids: redactionManifestIds,
      redaction_hash: hashStable(redactionManifests),
    },
  };
}

function createProjectionReport(redactionManifests = []) {
  return {
    errors: [],
    skipped_events: [],
    deterministic_hash: "",
    redaction_manifest_ids: redactionManifests.map((manifest) => manifest.manifest_id),
  };
}

function normalizeNodePayload(event) {
  return event.payload?.node || event.payload;
}

function normalizeEdgePayload(event) {
  return event.payload?.edge || event.payload;
}

function normalizeStatusPayload(event) {
  return {
    node_id: event.payload?.node_id || event.payload?.nodeId,
    status: event.payload?.status,
  };
}

function projectionError(traceView, event, errorType, message) {
  return {
    traceView,
    projectionErrors: [buildProjectionError(event, errorType, message, "error")],
    skippedEvents: [event.event_id],
  };
}

function schemaError(traceView, event, message) {
  return projectionError(traceView, event, "schema_invalid", message);
}

function buildProjectionError(event, errorType, message, severity) {
  return {
    event_id: event.event_id,
    seq: event.seq,
    error_type: errorType,
    message,
    severity,
  };
}

function applyDomainEventToTraceView(traceView, event) {
  if (event.type === "DSL_FINALIZED") {
    return applyDslFinalized(traceView, event);
  }
  if (event.type === "CONTEXT_PACKAGE_CREATED") {
    return applyContextPackageCreated(traceView, event);
  }
  if (event.type === "PLAN_CREATED") {
    return applyPlanCreated(traceView, event);
  }
  if (event.type === "PLAN_VERIFIED") {
    return applyPlanVerified(traceView, event);
  }
  if (event.type === "PATCH_CREATED") {
    return applyPatchCreated(traceView, event);
  }
  if (event.type === "SANDBOX_RESULT_RECORDED") {
    return applySandboxResultRecorded(traceView, event);
  }
  if (event.type === "USER_INTERRUPT_RECEIVED") {
    return applyUserInterruptReceived(traceView, event);
  }
  if (event.type === "CONTEXT_BUILT" || event.type === "AGENT_CONTEXT_BUILT") {
    return applyAgentContextBuilt(traceView, event);
  }
  if (event.type === "EXPERIENCE_CANDIDATE_CREATED") {
    return applyExperienceCandidateCreated(traceView, event);
  }
  return null;
}

function applyDslFinalized(traceView, event) {
  const payload = event.payload || {};
  const nodeId = payload.dsl_node_id || payload.node_id || `dsl_${event.seq}`;
  const result = appendNode(traceView, event, {
    id: nodeId,
    task_id: event.task_id,
    type: "final_dsl",
    summary: payload.summary || payload.requirement_summary || "",
    status: "verified",
    produced_by: event.producer || "dslAgent",
    created_at: event.created_at,
    metadata: payload.metadata || {},
  });
  return result || projectionResult(traceView);
}

function applyContextPackageCreated(traceView, event) {
  const payload = event.payload || {};
  const nodeId = payload.context_package_node_id || payload.node_id || `context_package_${event.seq}`;
  const nodeResult = appendNode(traceView, event, {
    id: nodeId,
    task_id: event.task_id,
    type: "context_package",
    summary: payload.summary || "",
    status: payload.status || "created",
    produced_by: event.producer || "contextAgent",
    created_at: event.created_at,
    metadata: payload.metadata || {},
  });
  if (nodeResult) return nodeResult;

  if (payload.depends_on_dsl_node_id) {
    const edgeResult = appendDerivedEdge(traceView, event, {
      relation: "depends_on",
      from_node_id: nodeId,
      to_node_id: payload.depends_on_dsl_node_id,
      suffix: payload.depends_on_dsl_node_id,
    });
    if (edgeResult) return edgeResult;
  }
  return projectionResult(traceView);
}

function applyPlanCreated(traceView, event) {
  const payload = event.payload || {};
  const nodeId = payload.plan_node_id || payload.node_id || `plan_${event.seq}`;
  const nodeResult = appendNode(traceView, event, {
    id: nodeId,
    task_id: event.task_id,
    type: "plan",
    summary: payload.summary || "",
    status: payload.status || "created",
    produced_by: event.producer || "planAgent",
    created_at: event.created_at,
    metadata: payload.metadata || {},
  });
  if (nodeResult) return nodeResult;

  for (const dependencyNodeId of payload.depends_on_node_ids || []) {
    const edgeResult = appendDerivedEdge(traceView, event, {
      relation: "depends_on",
      from_node_id: nodeId,
      to_node_id: dependencyNodeId,
      suffix: dependencyNodeId,
    });
    if (edgeResult) return edgeResult;
  }
  return projectionResult(traceView);
}

function applyPlanVerified(traceView, event) {
  const payload = event.payload || {};
  const planNodeId = payload.plan_node_id || payload.node_id;
  const statusResult = applyNodeStatus(traceView, event, planNodeId, "verified");
  return statusResult || projectionResult(traceView);
}

function applyPatchCreated(traceView, event) {
  const payload = event.payload || {};
  const nodeId = payload.patch_node_id || payload.node_id || `patch_${event.seq}`;
  const nodeResult = appendNode(traceView, event, {
    id: nodeId,
    task_id: event.task_id,
    type: "patch",
    summary: payload.summary || "",
    status: payload.status || "created",
    produced_by: event.producer || "codegenAgent",
    created_at: event.created_at,
    metadata: payload.metadata || {},
  });
  if (nodeResult) return nodeResult;

  if (payload.depends_on_plan_node_id) {
    const edgeResult = appendDerivedEdge(traceView, event, {
      relation: "depends_on",
      from_node_id: nodeId,
      to_node_id: payload.depends_on_plan_node_id,
      suffix: payload.depends_on_plan_node_id,
    });
    if (edgeResult) return edgeResult;
  }
  return projectionResult(traceView);
}

function applySandboxResultRecorded(traceView, event) {
  const payload = event.payload || {};
  const nodeId = payload.sandbox_node_id || payload.node_id || `sandbox_${event.seq}`;
  const nodeResult = appendNode(traceView, event, {
    id: nodeId,
    task_id: event.task_id,
    type: "sandbox_result",
    summary: payload.summary || payload.error_summary || "",
    status: payload.success === false ? "failed" : "verified",
    produced_by: event.producer || "testRunnerAgent",
    created_at: event.created_at,
    metadata: sanitizeMetadata({
      ...payload.metadata,
      command: payload.command,
      success: payload.success,
      exit_code: payload.exit_code,
      error_type: payload.error_type,
    }),
  });
  if (nodeResult) return nodeResult;

  if (payload.patch_node_id) {
    const edgeResult = appendDerivedEdge(traceView, event, {
      relation: "depends_on",
      from_node_id: nodeId,
      to_node_id: payload.patch_node_id,
      suffix: payload.patch_node_id,
    });
    if (edgeResult) return edgeResult;
  }
  return projectionResult(traceView);
}

function applyUserInterruptReceived(traceView, event) {
  const payload = event.payload || {};
  const nodeId = payload.interrupt_node_id || `interrupt_${event.seq}`;
  const runId = event.run_id || payload.run_id;
  ensureMetadata(traceView);
  if (runId && payload.run_generation !== undefined) {
    traceView.metadata.run_generations ||= {};
    traceView.metadata.run_generations[runId] = payload.run_generation;
  }

  const nodeResult = appendNode(traceView, event, {
    id: nodeId,
    task_id: event.task_id,
    run_id: runId,
    type: "interrupt_instruction",
    summary: payload.message || payload.summary || "",
    status: "active",
    produced_by: "user",
    created_at: event.created_at,
    metadata: sanitizeMetadata({
      message: payload.message,
      extracted_constraints: payload.extracted_constraints || [],
      current_node_id: payload.current_node_id,
      recommended_action: payload.recommended_action,
      run_generation: payload.run_generation,
    }),
  });
  if (nodeResult) return nodeResult;

  if (payload.current_node_id) {
    const edgeResult = appendDerivedEdge(traceView, event, {
      relation: "user_interrupts",
      from_node_id: nodeId,
      to_node_id: payload.current_node_id,
      suffix: payload.current_node_id,
    });
    if (edgeResult) return edgeResult;
  }

  for (const affectedNodeId of payload.affected_node_ids || []) {
    const edgeResult = appendDerivedEdge(traceView, event, {
      relation: "invalidates",
      from_node_id: nodeId,
      to_node_id: affectedNodeId,
      suffix: affectedNodeId,
    });
    if (edgeResult) return edgeResult;

    if (payload.invalidate_affected_nodes === true) {
      const statusResult = applyNodeStatus(traceView, event, affectedNodeId, "invalidated");
      if (statusResult) return statusResult;
    }
  }

  return projectionResult(traceView);
}

function applyAgentContextBuilt(traceView, event) {
  const projectionErrors = [];
  const skippedEvents = [];
  ensureMetadata(traceView);
  traceView.metadata.agent_context_built ||= [];
  const { full_context, ...safePayload } = event.payload || {};
  traceView.metadata.agent_context_built.push(sanitizeMetadata({
    context_id: safePayload.context_id,
    agent_name: safePayload.agent_name,
    current_node_id: safePayload.current_node_id,
    source_node_ids: safePayload.source_node_ids,
    source_event_ids: safePayload.source_event_ids,
    budget_report: safePayload.budget_report,
    privacy_report: safePayload.privacy_report,
    context_cache_ref: safePayload.context_cache_ref,
  }));
  if (full_context !== undefined) {
    projectionErrors.push(buildProjectionError(event, "schema_invalid", `${event.type} full_context was ignored during projection.`, "warning"));
    skippedEvents.push(event.event_id);
  }
  return { traceView, projectionErrors, skippedEvents };
}

function applyExperienceCandidateCreated(traceView, event) {
  const payload = event.payload || {};
  const nodeId = payload.experience_node_id || payload.node_id || `experience_${event.seq}`;
  const result = appendNode(traceView, event, {
    id: nodeId,
    task_id: event.task_id,
    type: "experience_candidate",
    summary: payload.summary || "",
    status: payload.status || "created",
    produced_by: event.producer || "experienceAgent",
    created_at: event.created_at,
    metadata: payload.metadata || {},
  });
  return result || projectionResult(traceView);
}

function appendNode(traceView, event, node, missingMessage = "Trace node requires an id.") {
  if (!node?.id) {
    return schemaError(traceView, event, missingMessage);
  }
  if (Object.prototype.hasOwnProperty.call(node, "depends_on")) {
    return schemaError(traceView, event, "TraceNode must not contain depends_on.");
  }
  if (traceView.nodes.some((candidate) => candidate.id === node.id)) {
    return projectionError(traceView, event, "duplicate_node", `Trace node "${node.id}" already exists.`);
  }
  traceView.nodes.push(node);
  sortTraceView(traceView);
  return null;
}

function appendEdge(traceView, event, edge) {
  if (!edge?.id || !edge.from_node_id || !edge.to_node_id || !edge.relation) {
    return schemaError(traceView, event, "TRACE_EDGE_APPENDED requires id, from_node_id, to_node_id, and relation.");
  }
  if (traceView.edges.some((candidate) => candidate.id === edge.id)) {
    return projectionError(traceView, event, "duplicate_edge", `Trace edge "${edge.id}" already exists.`);
  }
  traceView.edges.push(edge);
  sortTraceView(traceView);
  return null;
}

function appendDerivedEdge(traceView, event, { relation, from_node_id, to_node_id, suffix }) {
  return appendEdge(traceView, event, {
    id: `edge_${event.seq}_${relation}_${safeIdSegment(suffix || to_node_id)}`,
    task_id: event.task_id,
    from_node_id,
    to_node_id,
    relation,
    confidence: "deterministic",
    created_at: event.created_at,
  });
}

function applyNodeStatus(traceView, event, nodeId, status) {
  if (!nodeId || !status) {
    return schemaError(traceView, event, "Status change requires node_id and status.");
  }

  const node = traceView.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) {
    return projectionError(traceView, event, "missing_node", `Trace node "${nodeId}" does not exist.`);
  }

  if (node.status !== status && !isLegalStatusTransition(node.status, status)) {
    return projectionError(
      traceView,
      event,
      "invalid_status_transition",
      `Illegal status transition ${node.status} -> ${status} for node "${node.id}".`,
    );
  }

  node.status = status;
  node.updated_at = event.created_at;
  sortTraceView(traceView);
  return null;
}

function projectionResult(traceView) {
  return { traceView, projectionErrors: [], skippedEvents: [] };
}

function isLegalStatusTransition(fromStatus, toStatus) {
  return LEGAL_STATUS_TRANSITIONS.has(`${fromStatus}->${toStatus}`);
}

function stripVolatileTraceViewFields(traceView) {
  const { generated_at, view_hash, ...stableTraceView } = traceView;
  return stableTraceView;
}

function sortTraceView(traceView) {
  traceView.nodes.sort((left, right) => left.id.localeCompare(right.id));
  traceView.edges.sort((left, right) => left.id.localeCompare(right.id));
}

function ensureMetadata(traceView) {
  traceView.metadata ||= {};
}

function sanitizeMetadata(value) {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value).filter(([key, entryValue]) => key !== "full_context" && entryValue !== undefined),
  );
}

function safeIdSegment(value) {
  return String(value || "target").replace(/[^a-zA-Z0-9_-]+/g, "_");
}

function hashStable(value) {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function safePathSegment(value) {
  return encodeURIComponent(value).replace(/%/g, "_");
}

function projectRoot() {
  return path.resolve(__dirname, "../../../..");
}

const defaultEventStore = new EventStore({ storageRoot: path.join(projectRoot(), ".ai-runs", "context") });
const defaultTraceProjector = new TraceProjector({ eventStore: defaultEventStore });

module.exports = {
  TraceProjector,
  PROJECTOR_VERSION,
  LEGAL_STATUS_TRANSITIONS,
  rebuildTraceView: defaultTraceProjector.rebuildTraceView.bind(defaultTraceProjector),
  applyEventToTraceView: defaultTraceProjector.applyEventToTraceView.bind(defaultTraceProjector),
  getTraceView: defaultTraceProjector.getTraceView.bind(defaultTraceProjector),
  hashStable,
};
