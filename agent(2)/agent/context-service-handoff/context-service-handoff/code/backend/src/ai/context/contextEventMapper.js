const RAW_FIELD_NAMES = new Set([
  "full_context",
  "full_chat_history",
  "full_sandbox_log",
  "full_patch_diff",
  "raw_payload",
  "sandbox_log",
  "patch_diff",
]);

const STANDARD_CONTEXT_EVENT_TYPES = new Set([
  "TASK_CREATED",
  "DSL_FINALIZED",
  "CONTEXT_PACKAGE_CREATED",
  "PLAN_CREATED",
  "PLAN_VERIFIED",
  "PATCH_CREATED",
  "SANDBOX_RESULT_RECORDED",
  "USER_INTERRUPT_RECEIVED",
  "CONTEXT_BUILT",
  "AGENT_CONTEXT_BUILT",
  "EXPERIENCE_CANDIDATE_CREATED",
  "TRACE_NODE_APPENDED",
  "TRACE_EDGE_APPENDED",
  "TRACE_NODE_STATUS_CHANGED",
]);

function mapContextEventForAppend({ taskId, event, existingEvents = [] }) {
  if (!taskId || typeof taskId !== "string") {
    throw new Error("taskId is required.");
  }
  if (!event || typeof event !== "object") {
    throw new Error("event is required.");
  }

  if (event.type === "PLAN_CREATED") {
    return mapPlanCreated(taskId, event, existingEvents);
  }
  if (event.type === "PATCH_GENERATED") {
    return [mapPatchGenerated(event)];
  }
  if (event.type === "REVIEW_COMPLETED") {
    return mapReviewCompleted(event);
  }
  if (event.type === "EXECUTION_COMPLETED") {
    return [mapExecutionCompleted(event)];
  }
  if (event.type === "VERIFICATION_COMPLETED") {
    return mapVerificationCompleted(event);
  }
  if (event.type === "TASK_FINISHED") {
    return mapTaskFinished(event);
  }

  if (STANDARD_CONTEXT_EVENT_TYPES.has(event.type)) {
    return [stripStoreOwnedFields(event)];
  }

  return [stripStoreOwnedFields(event)];
}

function mapPlanCreated(taskId, event, existingEvents) {
  if (isNativePlanCreated(event)) {
    return [stripStoreOwnedFields(event)];
  }

  const payload = event.payload || {};
  const plan = payload.plan || payload;
  const dslNodeId = payload.dsl_node_id || "dsl_root";
  const nodeId = payload.plan_node_id || event.span_id || payload.node_id || "plan_root";
  const summary = payload.summary || plan.summary || plan.task_name || summarizeList(plan.steps) || "Plan created";
  const mappedEvents = [];

  if (!existingEvents.some((candidate) => candidate.type === "TASK_CREATED")) {
    mappedEvents.push(copyBaseEvent(event, {
      type: "TASK_CREATED",
      producer: event.producer || "pythonRuntime",
      payload: {
        summary,
        requirement: payload.requirement || plan.task_name || summary,
        metadata: compactMetadata({
          source_event_type: event.type,
          task_id: taskId,
        }),
      },
      idempotency_key: `context-wrapper:${taskId}:task-created`,
    }));
  }

  if (!existingEvents.some((candidate) => candidate.type === "DSL_FINALIZED")) {
    mappedEvents.push(copyBaseEvent(event, {
      type: "DSL_FINALIZED",
      producer: "dslAgent",
      payload: {
        dsl_node_id: dslNodeId,
        summary,
        metadata: compactMetadata({
          source_event_type: event.type,
          acceptance_criteria: plan.acceptance_criteria,
          target_files_hint: plan.target_files_hint,
          runtime_instructions: plan.runtime_instructions,
        }),
      },
      idempotency_key: `context-wrapper:${taskId}:dsl-finalized`,
    }));
  }

  mappedEvents.push(copyBaseEvent(event, {
    type: "PLAN_CREATED",
    producer: event.producer || "planAgent",
    payload: {
      plan_node_id: nodeId,
      summary,
      status: payload.status || plan.status || "created",
      depends_on_node_ids: payload.depends_on_node_ids || [dslNodeId],
      metadata: compactMetadata({
        source_event_type: event.type,
        plan,
      }),
    },
  }));

  return mappedEvents;
}

function mapPatchGenerated(event) {
  const payload = event.payload || {};
  const patchPlan = payload.patch_plan || payload;
  const nodeId = payload.patch_node_id || event.span_id || payload.node_id || "patch_root";
  const dependencyNodeId = payload.depends_on_plan_node_id || event.parent_span_id;
  return copyBaseEvent(event, {
    type: "PATCH_CREATED",
    producer: event.producer || "codegenAgent",
    payload: {
      patch_node_id: nodeId,
      summary: payload.summary || patchPlan.summary || "Patch generated",
      status: payload.status || "created",
      ...(dependencyNodeId ? { depends_on_plan_node_id: dependencyNodeId } : {}),
      metadata: compactMetadata({
        source_event_type: event.type,
        patch_plan: patchPlan,
        changed_files: collectPatchFiles(patchPlan),
      }),
    },
  });
}

function mapReviewCompleted(event) {
  const payload = event.payload || {};
  const review = payload.review || payload;
  const nodeId = payload.review_node_id || event.span_id || payload.node_id || "review_root";
  const dependencyNodeId = payload.depends_on_node_id || event.parent_span_id;
  const events = [
    copyBaseEvent(event, {
      type: "TRACE_NODE_APPENDED",
      producer: event.producer || "deliveryAgent",
      payload: {
        node: {
          id: nodeId,
          type: "review",
          status: review.approved === false ? "failed" : "verified",
          summary: payload.summary || review.summary || "Review completed",
          produced_by: event.producer || "deliveryAgent",
          metadata: compactMetadata({
            source_event_type: event.type,
            review,
          }),
        },
      },
      idempotency_key: derivedIdempotencyKey(event, "node"),
    }),
  ];

  if (dependencyNodeId) {
    events.push(copyBaseEvent(event, {
      type: "TRACE_EDGE_APPENDED",
      producer: event.producer || "deliveryAgent",
      payload: {
        edge: {
          id: edgeId(nodeId, "depends_on", dependencyNodeId),
          from_node_id: nodeId,
          to_node_id: dependencyNodeId,
          relation: "depends_on",
          confidence: "deterministic",
        },
      },
      idempotency_key: derivedIdempotencyKey(event, "edge"),
    }));
  }

  return events;
}

function mapExecutionCompleted(event) {
  const payload = event.payload || {};
  const executionResult = payload.execution_result || payload;
  const nodeId = payload.sandbox_node_id || event.span_id || payload.node_id || "sandbox_root";
  const dependencyNodeId = payload.patch_node_id || event.parent_span_id;
  return copyBaseEvent(event, {
    type: "SANDBOX_RESULT_RECORDED",
    producer: event.producer || "repairAgent",
    payload: {
      sandbox_node_id: nodeId,
      summary: payload.summary || executionResult.summary || "Execution completed",
      success: payload.success ?? executionResult.executed === true,
      ...(dependencyNodeId ? { patch_node_id: dependencyNodeId } : {}),
      command: payload.command || executionResult.command,
      exit_code: payload.exit_code ?? executionResult.exit_code,
      error_type: payload.error_type || executionResult.error_type,
      metadata: compactMetadata({
        source_event_type: event.type,
        execution_result: executionResult,
      }),
    },
  });
}

function mapVerificationCompleted(event) {
  const payload = event.payload || {};
  const verification = payload.verification_result || payload;
  const nodeId = payload.verify_node_id || event.span_id || payload.node_id || "verify_root";
  const dependencyNodeId = payload.depends_on_node_id || event.parent_span_id;
  const events = [
    copyBaseEvent(event, {
      type: "TRACE_NODE_APPENDED",
      producer: event.producer || "deliveryAgent",
      payload: {
        node: {
          id: nodeId,
          type: "verification_result",
          status: verification.passed === false ? "failed" : "verified",
          summary: payload.summary || verification.summary || "Verification completed",
          produced_by: event.producer || "deliveryAgent",
          metadata: compactMetadata({
            source_event_type: event.type,
            verification_result: verification,
          }),
        },
      },
      idempotency_key: derivedIdempotencyKey(event, "node"),
    }),
  ];

  if (dependencyNodeId) {
    events.push(copyBaseEvent(event, {
      type: "TRACE_EDGE_APPENDED",
      producer: event.producer || "deliveryAgent",
      payload: {
        edge: {
          id: edgeId(nodeId, "depends_on", dependencyNodeId),
          from_node_id: nodeId,
          to_node_id: dependencyNodeId,
          relation: "depends_on",
          confidence: "deterministic",
        },
      },
      idempotency_key: derivedIdempotencyKey(event, "edge"),
    }));
  }

  return events;
}

function mapTaskFinished(event) {
  const payload = event.payload || {};
  const summary = payload.final_summary || payload;
  const nodeId = payload.finish_node_id || event.span_id || payload.node_id || "finish_root";
  const dependencyNodeId = payload.depends_on_node_id || event.parent_span_id;
  const events = [
    copyBaseEvent(event, {
      type: "TRACE_NODE_APPENDED",
      producer: event.producer || "deliveryAgent",
      payload: {
        node: {
          id: nodeId,
          type: "delivery_report",
          status: summary.status === "FAILED" ? "failed" : "verified",
          summary: payload.summary || summary.message || "Task finished",
          produced_by: event.producer || "deliveryAgent",
          metadata: compactMetadata({
            source_event_type: event.type,
            final_summary: summary,
          }),
        },
      },
      idempotency_key: derivedIdempotencyKey(event, "node"),
    }),
  ];

  if (dependencyNodeId) {
    events.push(copyBaseEvent(event, {
      type: "TRACE_EDGE_APPENDED",
      producer: event.producer || "deliveryAgent",
      payload: {
        edge: {
          id: edgeId(nodeId, "depends_on", dependencyNodeId),
          from_node_id: nodeId,
          to_node_id: dependencyNodeId,
          relation: "depends_on",
          confidence: "deterministic",
        },
      },
      idempotency_key: derivedIdempotencyKey(event, "edge"),
    }));
  }

  return events;
}

function isNativePlanCreated(event) {
  const payload = event.payload || {};
  return Boolean(payload.plan_node_id || payload.node_id || payload.depends_on_node_ids);
}

function copyBaseEvent(event, overrides) {
  const base = stripStoreOwnedFields(event);
  return {
    ...base,
    ...overrides,
    payload: overrides.payload || {},
    idempotency_key: overrides.idempotency_key || event.idempotency_key,
  };
}

function stripStoreOwnedFields(event) {
  const {
    event_id,
    seq,
    task_id,
    created_at,
    schema_version,
    ...safeEvent
  } = event || {};
  return {
    ...safeEvent,
    payload: safeEvent.payload || {},
  };
}

function compactMetadata(value) {
  return removeRawFields(JSON.parse(JSON.stringify(value || {})));
}

function removeRawFields(value) {
  if (Array.isArray(value)) {
    return value.map(removeRawFields);
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !RAW_FIELD_NAMES.has(key))
      .map(([key, entryValue]) => [key, removeRawFields(entryValue)]),
  );
}

function summarizeList(value) {
  return Array.isArray(value) ? value.filter(Boolean).join("; ") : "";
}

function collectPatchFiles(patchPlan) {
  if (!patchPlan || typeof patchPlan !== "object" || !Array.isArray(patchPlan.patches)) return [];
  return patchPlan.patches.map((patch) => patch.file).filter(Boolean);
}

function derivedIdempotencyKey(event, suffix) {
  const base = event.idempotency_key || `${event.type || "event"}:${event.trace_id || "trace"}:${event.span_id || "span"}`;
  return `${base}:${suffix}`;
}

function edgeId(fromNodeId, relation, toNodeId) {
  return `edge_${safeIdPart(fromNodeId)}_${relation}_${safeIdPart(toNodeId)}`;
}

function safeIdPart(value) {
  return String(value || "none").replace(/[^a-zA-Z0-9_-]/g, "_");
}

module.exports = {
  STANDARD_CONTEXT_EVENT_TYPES,
  mapContextEventForAppend,
};
