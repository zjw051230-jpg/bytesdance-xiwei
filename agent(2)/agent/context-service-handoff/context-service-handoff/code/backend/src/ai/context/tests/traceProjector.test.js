const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventStore } = require("../eventStore");
const { TraceProjector } = require("../traceProjector");
const { RedactionManifestStore } = require("../redactionManifest");

function createHarness(now = () => "2026-06-07T00:00:00.000Z") {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "trace-projector-"));
  const redactionManifestStore = new RedactionManifestStore({
    storageRoot,
    now,
    idGenerator: (() => {
      let nextId = 1;
      return () => `redact_${nextId++}`;
    })(),
  });
  const eventStore = new EventStore({
    storageRoot,
    now,
    idGenerator: (() => {
      let nextId = 1;
      return () => `evt_${nextId++}`;
    })(),
  });
  const traceProjector = new TraceProjector({
    storageRoot,
    eventStore,
    redactionManifestStore,
    now,
    projectorVersion: "test-projector-v1",
  });
  return { eventStore, traceProjector, redactionManifestStore };
}

function appendProjectableEvents(eventStore) {
  eventStore.appendEvent("task-1", {
    type: "TRACE_NODE_APPENDED",
    payload: { node: { id: "plan-1", type: "plan", summary: "Plan", status: "created" } },
  });
  eventStore.appendEvent("task-1", {
    type: "TRACE_NODE_APPENDED",
    payload: { id: "patch-1", type: "patch", summary: "Patch", status: "created" },
  });
  eventStore.appendEvent("task-1", {
    type: "TRACE_EDGE_APPENDED",
    payload: {
      edge: {
        id: "edge-1",
        from_node_id: "patch-1",
        to_node_id: "plan-1",
        relation: "depends_on",
      },
    },
  });
  eventStore.appendEvent("task-1", {
    type: "TRACE_NODE_STATUS_CHANGED",
    payload: { node_id: "patch-1", status: "active" },
  });
}

describe("TraceProjector", () => {
  test("rebuilds nodes, edges, and status changes from events", () => {
    const { eventStore, traceProjector } = createHarness();
    appendProjectableEvents(eventStore);

    const result = traceProjector.rebuildTraceView("task-1");

    expect(result.trace_view).toMatchObject({
      task_id: "task-1",
      projector_version: "test-projector-v1",
      source_event_count: 4,
      source_last_seq: 4,
    });
    expect(result.trace_view.nodes).toEqual([
      expect.objectContaining({ id: "patch-1", status: "active" }),
      expect.objectContaining({ id: "plan-1", status: "created" }),
    ]);
    expect(result.trace_view.edges).toEqual([
      expect.objectContaining({
        id: "edge-1",
        from_node_id: "patch-1",
        to_node_id: "plan-1",
        relation: "depends_on",
      }),
    ]);
    expect(result.projection_report.errors).toEqual([]);
  });

  test("does not append new events during rebuild", () => {
    const { eventStore, traceProjector } = createHarness();
    appendProjectableEvents(eventStore);
    const eventCountBefore = eventStore.readEvents("task-1").length;

    traceProjector.rebuildTraceView("task-1");

    expect(eventStore.readEvents("task-1")).toHaveLength(eventCountBefore);
  });

  test("keeps view_hash stable for the same events and projector version", () => {
    const { eventStore, traceProjector } = createHarness();
    appendProjectableEvents(eventStore);

    const first = traceProjector.rebuildTraceView("task-1").trace_view.view_hash;
    const second = traceProjector.rebuildTraceView("task-1").trace_view.view_hash;

    expect(first).toBe(second);
  });

  test("excludes generated_at from view_hash", () => {
    let generatedAt = "2026-06-07T00:00:00.000Z";
    const { eventStore, traceProjector } = createHarness(() => generatedAt);
    appendProjectableEvents(eventStore);

    const first = traceProjector.rebuildTraceView("task-1").trace_view;
    generatedAt = "2026-06-07T00:01:00.000Z";
    const second = traceProjector.rebuildTraceView("task-1").trace_view;

    expect(first.generated_at).not.toBe(second.generated_at);
    expect(first.view_hash).toBe(second.view_hash);
  });

  test("records illegal status transitions in projection_report without mutating trace_view", () => {
    const { eventStore, traceProjector } = createHarness();
    eventStore.appendEvent("task-1", {
      type: "TRACE_NODE_APPENDED",
      payload: { node: { id: "node-1", type: "sandbox_result", summary: "Sandbox", status: "created" } },
    });
    eventStore.appendEvent("task-1", {
      type: "TRACE_NODE_STATUS_CHANGED",
      payload: { node_id: "node-1", status: "failed" },
    });
    eventStore.appendEvent("task-1", {
      type: "TRACE_NODE_STATUS_CHANGED",
      payload: { node_id: "node-1", status: "verified" },
    });

    const result = traceProjector.rebuildTraceView("task-1");

    expect(result.trace_view.nodes[0]).toMatchObject({ id: "node-1", status: "failed" });
    expect(result.projection_report.errors).toEqual([
      expect.objectContaining({
        event_id: "evt_3",
        error_type: "invalid_status_transition",
      }),
    ]);
    expect(eventStore.readEvents("task-1")).toHaveLength(3);
  });

  test("getTraceView reads cached view when it exists", () => {
    const { eventStore, traceProjector } = createHarness();
    appendProjectableEvents(eventStore);
    const rebuilt = traceProjector.rebuildTraceView("task-1").trace_view;

    const cached = traceProjector.getTraceView("task-1");

    expect(cached).toEqual(rebuilt);
  });

  test("getTraceView rebuilds when there is no cached view", () => {
    const { eventStore, traceProjector } = createHarness();
    appendProjectableEvents(eventStore);

    const traceView = traceProjector.getTraceView("task-1");

    expect(traceView.nodes.map((node) => node.id)).toEqual(["patch-1", "plan-1"]);
  });

  test("projects DSL_FINALIZED into a final_dsl node", () => {
    const { eventStore, traceProjector } = createHarness();
    eventStore.appendEvent("task-1", {
      type: "DSL_FINALIZED",
      producer: "dslAgent",
      payload: {
        dsl_node_id: "dsl_001",
        summary: "Final DSL",
        metadata: { constraints: ["frontend_only"] },
      },
    });

    const result = traceProjector.rebuildTraceView("task-1");

    expect(result.trace_view.nodes).toEqual([
      expect.objectContaining({
        id: "dsl_001",
        type: "final_dsl",
        summary: "Final DSL",
        status: "verified",
        produced_by: "dslAgent",
      }),
    ]);
  });

  test("projects CONTEXT_PACKAGE_CREATED and depends_on edge to DSL", () => {
    const { eventStore, traceProjector } = createHarness();
    eventStore.appendEvent("task-1", {
      type: "DSL_FINALIZED",
      payload: { dsl_node_id: "dsl_001", summary: "Final DSL" },
    });
    eventStore.appendEvent("task-1", {
      type: "CONTEXT_PACKAGE_CREATED",
      payload: {
        context_package_node_id: "context_001",
        summary: "Context package",
        depends_on_dsl_node_id: "dsl_001",
      },
    });

    const result = traceProjector.rebuildTraceView("task-1");

    expect(result.trace_view.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "context_001", type: "context_package" }),
    ]));
    expect(result.trace_view.edges).toEqual([
      expect.objectContaining({
        from_node_id: "context_001",
        to_node_id: "dsl_001",
        relation: "depends_on",
      }),
    ]);
  });

  test("projects PLAN_CREATED and PLAN_VERIFIED into a verified plan node", () => {
    const { eventStore, traceProjector } = createHarness();
    eventStore.appendEvent("task-1", {
      type: "DSL_FINALIZED",
      payload: { dsl_node_id: "dsl_001", summary: "Final DSL" },
    });
    eventStore.appendEvent("task-1", {
      type: "PLAN_CREATED",
      payload: {
        plan_node_id: "plan_001",
        summary: "Plan",
        depends_on_node_ids: ["dsl_001"],
      },
    });
    eventStore.appendEvent("task-1", {
      type: "PLAN_VERIFIED",
      payload: { plan_node_id: "plan_001" },
    });

    const result = traceProjector.rebuildTraceView("task-1");

    expect(result.trace_view.nodes.find((node) => node.id === "plan_001")).toMatchObject({
      type: "plan",
      status: "verified",
    });
    expect(result.trace_view.edges).toEqual([
      expect.objectContaining({
        from_node_id: "plan_001",
        to_node_id: "dsl_001",
        relation: "depends_on",
      }),
    ]);
  });

  test("projects PATCH_CREATED and SANDBOX_RESULT_RECORDED with dependency edges", () => {
    const { eventStore, traceProjector } = createHarness();
    eventStore.appendEvent("task-1", {
      type: "PLAN_CREATED",
      payload: { plan_node_id: "plan_001", summary: "Plan" },
    });
    eventStore.appendEvent("task-1", {
      type: "PATCH_CREATED",
      payload: {
        patch_node_id: "patch_001",
        summary: "Patch",
        depends_on_plan_node_id: "plan_001",
      },
    });
    eventStore.appendEvent("task-1", {
      type: "SANDBOX_RESULT_RECORDED",
      payload: {
        sandbox_node_id: "sandbox_001",
        summary: "Test failed",
        success: false,
        patch_node_id: "patch_001",
      },
    });

    const result = traceProjector.rebuildTraceView("task-1");

    expect(result.trace_view.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "patch_001", type: "patch" }),
      expect.objectContaining({ id: "sandbox_001", type: "sandbox_result", status: "failed" }),
    ]));
    expect(result.trace_view.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from_node_id: "patch_001", to_node_id: "plan_001", relation: "depends_on" }),
      expect.objectContaining({ from_node_id: "sandbox_001", to_node_id: "patch_001", relation: "depends_on" }),
    ]));
  });

  test("projects USER_INTERRUPT_RECEIVED into one interrupt_instruction node without trace mutation event", () => {
    const { eventStore, traceProjector } = createHarness();
    eventStore.appendEvent("task-1", {
      type: "PLAN_CREATED",
      payload: { plan_node_id: "plan_001", summary: "Plan" },
    });
    eventStore.appendEvent("task-1", {
      type: "USER_INTERRUPT_RECEIVED",
      payload: {
        run_id: "run_001",
        message: "Do not change backend",
        current_node_id: "plan_001",
        run_generation: 2,
      },
    });

    const result = traceProjector.rebuildTraceView("task-1");
    const interruptNodes = result.trace_view.nodes.filter((node) => node.type === "interrupt_instruction");

    expect(eventStore.readEventsByType("task-1", "TRACE_NODE_APPENDED")).toEqual([]);
    expect(interruptNodes).toHaveLength(1);
    expect(interruptNodes[0]).toMatchObject({
      id: "interrupt_2",
      summary: "Do not change backend",
      status: "active",
      produced_by: "user",
      metadata: expect.objectContaining({ run_generation: 2 }),
    });
    expect(result.trace_view.edges).toEqual([
      expect.objectContaining({
        from_node_id: "interrupt_2",
        to_node_id: "plan_001",
        relation: "user_interrupts",
      }),
    ]);
    expect(result.trace_view.metadata.run_generations).toEqual({ run_001: 2 });
  });

  test("USER_INTERRUPT_RECEIVED invalidates affected nodes through the status machine", () => {
    const { eventStore, traceProjector } = createHarness();
    eventStore.appendEvent("task-1", {
      type: "PLAN_CREATED",
      payload: { plan_node_id: "plan_001", summary: "Plan" },
    });
    eventStore.appendEvent("task-1", {
      type: "PATCH_CREATED",
      payload: { patch_node_id: "patch_001", summary: "Patch", depends_on_plan_node_id: "plan_001" },
    });
    eventStore.appendEvent("task-1", {
      type: "USER_INTERRUPT_RECEIVED",
      payload: {
        interrupt_node_id: "interrupt_001",
        message: "Invalidate patch",
        affected_node_ids: ["patch_001"],
        invalidate_affected_nodes: true,
      },
    });

    const result = traceProjector.rebuildTraceView("task-1");

    expect(result.trace_view.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        from_node_id: "interrupt_001",
        to_node_id: "patch_001",
        relation: "invalidates",
      }),
    ]));
    expect(result.trace_view.nodes.find((node) => node.id === "patch_001")).toMatchObject({
      status: "invalidated",
    });
  });

  test("AGENT_CONTEXT_BUILT ignores full_context and records a warning", () => {
    const { eventStore, traceProjector } = createHarness();
    eventStore.appendEvent("task-1", {
      type: "AGENT_CONTEXT_BUILT",
      payload: {
        context_id: "ctx_001",
        agent_name: "repairAgent",
        full_context: { secret: "should not project" },
        source_node_ids: ["dsl_001"],
      },
    });

    const result = traceProjector.rebuildTraceView("task-1");

    expect(JSON.stringify(result.trace_view)).not.toContain("should not project");
    expect(result.projection_report.errors).toEqual([
      expect.objectContaining({
        error_type: "schema_invalid",
        severity: "warning",
        message: expect.stringContaining("full_context"),
      }),
    ]);
  });

  test("CONTEXT_BUILT projects lightweight context metadata", () => {
    const { eventStore, traceProjector } = createHarness();
    eventStore.appendEvent("task-1", {
      type: "CONTEXT_BUILT",
      payload: {
        context_id: "ctx_001",
        agent_name: "repairAgent",
        current_node_id: "sandbox_001",
        source_node_ids: ["sandbox_001", "patch_001"],
        source_event_ids: ["evt_001", "evt_002"],
        budget_report: { after_chars: 800 },
        privacy_report: { redacted: false },
        context_cache_ref: "tasks/task-1/context_cache/ctx_001.json",
      },
    });

    const result = traceProjector.rebuildTraceView("task-1");

    expect(result.trace_view.metadata.agent_context_built).toEqual([
      expect.objectContaining({
        context_id: "ctx_001",
        agent_name: "repairAgent",
        current_node_id: "sandbox_001",
        source_node_ids: ["sandbox_001", "patch_001"],
        source_event_ids: ["evt_001", "evt_002"],
        context_cache_ref: "tasks/task-1/context_cache/ctx_001.json",
      }),
    ]);
    expect(result.projection_report.errors).toEqual([]);
  });

  test("projects EXPERIENCE_CANDIDATE_CREATED into an experience_candidate node", () => {
    const { eventStore, traceProjector } = createHarness();
    eventStore.appendEvent("task-1", {
      type: "EXPERIENCE_CANDIDATE_CREATED",
      payload: {
        experience_node_id: "experience_001",
        summary: "Reusable repair lesson",
      },
    });

    const result = traceProjector.rebuildTraceView("task-1");

    expect(result.trace_view.nodes).toEqual([
      expect.objectContaining({
        id: "experience_001",
        type: "experience_candidate",
        summary: "Reusable repair lesson",
      }),
    ]);
  });

  test("keeps view_hash stable when replaying domain events", () => {
    const { eventStore, traceProjector } = createHarness();
    eventStore.appendEvent("task-1", {
      type: "TASK_CREATED",
      payload: { requirement: "Build trace memory" },
    });
    eventStore.appendEvent("task-1", {
      type: "DSL_FINALIZED",
      payload: { dsl_node_id: "dsl_001", summary: "Final DSL" },
    });
    eventStore.appendEvent("task-1", {
      type: "PLAN_CREATED",
      payload: { plan_node_id: "plan_001", summary: "Plan", depends_on_node_ids: ["dsl_001"] },
    });

    const first = traceProjector.rebuildTraceView("task-1").trace_view.view_hash;
    const second = traceProjector.rebuildTraceView("task-1").trace_view.view_hash;

    expect(first).toBe(second);
  });

  test("rebuildTraceView projects over redaction overlay safe events", () => {
    const { eventStore, traceProjector, redactionManifestStore } = createHarness();
    const leakedEvent = eventStore.appendEvent("task-1", {
      type: "DSL_FINALIZED",
      payload: {
        dsl_node_id: "dsl_001",
        summary: "Leaked sk-secret-value",
        metadata: { secret: "sk-secret-value" },
      },
    });
    redactionManifestStore.createRedactionManifest("task-1", {
      affected_event_ids: [leakedEvent.event_id],
      redacted_paths: ["payload.summary", "payload.metadata.secret"],
      reason: "secret_leak",
    });

    const result = traceProjector.rebuildTraceView("task-1");

    expect(JSON.stringify(result.trace_view)).not.toContain("sk-secret-value");
    expect(result.trace_view.nodes[0]).toMatchObject({
      summary: "[REDACTED]",
      metadata: { secret: "[REDACTED]" },
    });
    expect(result.trace_view.metadata.redaction_manifest_ids).toEqual(["redact_1"]);
    expect(result.projection_report.redaction_manifest_ids).toEqual(["redact_1"]);
    expect(result.trace_view.metadata.redaction_hash).toEqual(expect.any(String));
  });

  test("keeps view_hash stable for the same raw events and redaction manifests", () => {
    const { eventStore, traceProjector, redactionManifestStore } = createHarness();
    const leakedEvent = eventStore.appendEvent("task-1", {
      type: "DSL_FINALIZED",
      payload: {
        dsl_node_id: "dsl_001",
        summary: "Leaked sk-secret-value",
      },
    });
    redactionManifestStore.createRedactionManifest("task-1", {
      affected_event_ids: [leakedEvent.event_id],
      redacted_paths: ["payload.summary"],
      reason: "secret_leak",
    });

    const first = traceProjector.rebuildTraceView("task-1").trace_view.view_hash;
    const second = traceProjector.rebuildTraceView("task-1").trace_view.view_hash;

    expect(first).toBe(second);
  });
});
