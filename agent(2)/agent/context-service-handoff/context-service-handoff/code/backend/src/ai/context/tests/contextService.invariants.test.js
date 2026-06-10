const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  EventStore,
  IdempotencyConflictError,
  OptimisticConcurrencyError,
} = require("../eventStore");
const { TraceProjector } = require("../traceProjector");
const { TraceGraphStore } = require("../traceGraphStore");
const { CompactSummarizer } = require("../compactSummarizer");
const { ContextBenchmark } = require("../contextBenchmark");
const { RedactionManifestStore, applyRedactionOverlay } = require("../redactionManifest");

let cleanupRoots = [];

afterEach(() => {
  for (const root of cleanupRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  cleanupRoots = [];
});

function tempStorageRoot(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanupRoots.push(root);
  return root;
}

function createHarness(prefix = "context-invariants-") {
  const storageRoot = tempStorageRoot(prefix);
  let timestampOffset = 0;
  let nextEventId = 1;
  const now = () => new Date(Date.UTC(2026, 5, 7, 0, 0, timestampOffset++)).toISOString();
  const redactionManifestStore = new RedactionManifestStore({
    storageRoot,
    now,
    idGenerator: (() => {
      let nextManifestId = 1;
      return () => `redact_${nextManifestId++}`;
    })(),
  });
  const eventStore = new EventStore({
    storageRoot,
    now,
    idGenerator: () => `evt_${nextEventId++}`,
    redactionManifestStore,
  });
  const traceProjector = new TraceProjector({
    eventStore,
    redactionManifestStore,
    storageRoot,
    now,
    projectorVersion: "context-invariants-v1",
  });
  const traceGraphStore = new TraceGraphStore({
    eventStore,
    traceProjector,
    storageRoot,
    now,
  });

  return { eventStore, traceProjector, traceGraphStore, redactionManifestStore };
}

function appendProjectableChain(eventStore, taskId) {
  eventStore.appendEvent(taskId, {
    type: "DSL_FINALIZED",
    payload: { dsl_node_id: "dsl_001", summary: "Final DSL" },
  });
  eventStore.appendEvent(taskId, {
    type: "PLAN_CREATED",
    payload: { plan_node_id: "plan_001", summary: "Plan", depends_on_node_ids: ["dsl_001"] },
  });
  eventStore.appendEvent(taskId, {
    type: "PATCH_CREATED",
    payload: { patch_node_id: "patch_001", summary: "Patch", depends_on_plan_node_id: "plan_001" },
  });
}

function benchmarkContext(sourceNodeIds, constraints = ["frontend only"]) {
  return {
    source_node_ids: sourceNodeIds,
    budget_report: { after_chars: 500 },
    context: {
      dependency_summary: {
        value: { constraints },
        source_node_ids: sourceNodeIds,
      },
    },
  };
}

describe("Context Service invariants", () => {
  test("appendEvent assigns monotonically increasing seq and never rewrites old events", () => {
    const taskId = "task_invariant_append";
    const { eventStore } = createHarness();

    const first = eventStore.appendEvent(taskId, {
      type: "TASK_CREATED",
      payload: { summary: "first" },
    });
    const second = eventStore.appendEvent(taskId, {
      type: "DSL_FINALIZED",
      payload: { dsl_node_id: "dsl_001", summary: "second" },
    });

    expect([first.seq, second.seq]).toEqual([1, 2]);
    expect(eventStore.readEvents(taskId)[0]).toEqual(first);
  });

  test("idempotency_key returns existing event for same payload and conflicts for different payload", () => {
    const taskId = "task_invariant_idempotency";
    const { eventStore } = createHarness();

    const first = eventStore.appendEvent(taskId, {
      type: "TASK_CREATED",
      payload: { summary: "same" },
      idempotency_key: "task-created",
    });
    const replay = eventStore.appendEvent(taskId, {
      type: "TASK_CREATED",
      payload: { summary: "same" },
      idempotency_key: "task-created",
    });

    expect(replay).toEqual(first);
    expect(eventStore.readEvents(taskId)).toHaveLength(1);
    expect(() =>
      eventStore.appendEvent(taskId, {
        type: "TASK_CREATED",
        payload: { summary: "different" },
        idempotency_key: "task-created",
      })
    ).toThrow(IdempotencyConflictError);
  });

  test("expectedSeq conflict throws OptimisticConcurrencyError", () => {
    const taskId = "task_invariant_expected_seq";
    const { eventStore } = createHarness();

    eventStore.appendEvent(taskId, { type: "TASK_CREATED", payload: {} });

    expect(() =>
      eventStore.appendEvent(taskId, { type: "DSL_FINALIZED", payload: {} }, { expectedSeq: 0 })
    ).toThrow(OptimisticConcurrencyError);
  });

  test("rebuildTraceView does not write events and keeps view_hash stable", () => {
    const taskId = "task_invariant_projector";
    const { eventStore, traceProjector } = createHarness();
    appendProjectableChain(eventStore, taskId);
    const eventCountBefore = eventStore.readEvents(taskId).length;

    const first = traceProjector.rebuildTraceView(taskId).trace_view;
    const second = traceProjector.rebuildTraceView(taskId).trace_view;

    expect(eventStore.readEvents(taskId)).toHaveLength(eventCountBefore);
    expect(first.view_hash).toBe(second.view_hash);
  });

  test("generated_at does not participate in view_hash", () => {
    const taskId = "task_invariant_generated_at";
    const storageRoot = tempStorageRoot("context-invariants-generated-");
    const eventStore = new EventStore({
      storageRoot,
      now: () => "2026-06-07T00:00:00.000Z",
      idGenerator: (() => {
        let nextId = 1;
        return () => `evt_${nextId++}`;
      })(),
    });
    appendProjectableChain(eventStore, taskId);
    let generatedAt = "2026-06-07T00:00:00.000Z";
    const traceProjector = new TraceProjector({
      eventStore,
      storageRoot,
      now: () => generatedAt,
      projectorVersion: "context-invariants-v1",
    });

    const first = traceProjector.rebuildTraceView(taskId).trace_view;
    generatedAt = "2026-06-07T00:01:00.000Z";
    const second = traceProjector.rebuildTraceView(taskId).trace_view;

    expect(first.generated_at).not.toBe(second.generated_at);
    expect(first.view_hash).toBe(second.view_hash);
  });

  test("readSafeEvents and RedactionOverlay do not mutate raw events", () => {
    const taskId = "task_invariant_redaction";
    const { eventStore, redactionManifestStore } = createHarness();
    const leaked = eventStore.appendEvent(taskId, {
      type: "DSL_FINALIZED",
      payload: { dsl_node_id: "dsl_001", summary: "secret sk-secret123" },
    });
    const rawBefore = eventStore.readEvents(taskId);
    redactionManifestStore.createRedactionManifest(taskId, {
      affected_event_ids: [leaked.event_id],
      redacted_paths: ["payload.summary"],
      reason: "secret_leak",
    });

    const safeEvents = eventStore.readSafeEvents(taskId);
    const rawAfter = eventStore.readEvents(taskId);

    expect(safeEvents[0].payload.summary).toBe("[REDACTED]");
    expect(rawAfter).toEqual(rawBefore);

    const sourceEvents = [{ event_id: "evt_local", payload: { secret: "raw" } }];
    const overlay = applyRedactionOverlay(sourceEvents, [{
      manifest_id: "redact_local",
      affected_event_ids: ["evt_local"],
      redacted_paths: ["payload.secret"],
      reason: "secret_leak",
    }]);
    expect(overlay[0].payload.secret).toBe("[REDACTED]");
    expect(sourceEvents[0].payload.secret).toBe("raw");
  });

  test("getDependencyChain handles cycles and returns nodes, edges, and depth", () => {
    const taskId = "task_invariant_cycle";
    const { traceGraphStore } = createHarness();
    for (const nodeId of ["node_a", "node_b", "node_c"]) {
      traceGraphStore.appendTraceNode(taskId, {
        id: nodeId,
        type: "plan",
        summary: nodeId,
      });
    }
    traceGraphStore.appendTraceEdge(taskId, {
      id: "edge_a_b",
      from_node_id: "node_a",
      to_node_id: "node_b",
      relation: "depends_on",
    });
    traceGraphStore.appendTraceEdge(taskId, {
      id: "edge_b_c",
      from_node_id: "node_b",
      to_node_id: "node_c",
      relation: "depends_on",
    });
    traceGraphStore.appendTraceEdge(taskId, {
      id: "edge_c_a",
      from_node_id: "node_c",
      to_node_id: "node_a",
      relation: "depends_on",
    });

    const chain = traceGraphStore.getDependencyChain(taskId, "node_a", { maxDepth: 10 });

    expect(chain.target_node_id).toBe("node_a");
    expect(chain.chain_nodes.map((node) => node.id).sort()).toEqual(["node_a", "node_b", "node_c"]);
    expect(chain.chain_edges.map((edge) => edge.id).sort()).toEqual(["edge_a_b", "edge_b_c", "edge_c_a"]);
    expect(chain.depth).toBe(2);
  });

  test("SummaryArtifact output_hash is stable for the same input", () => {
    const summarizer = new CompactSummarizer({ idGenerator: () => "summary_001" });
    const traceView = {
      nodes: [
        { id: "plan_001", type: "plan", summary: "Plan" },
        { id: "patch_001", type: "patch", summary: "Patch" },
      ],
      edges: [
        { id: "edge_patch_plan", from_node_id: "patch_001", to_node_id: "plan_001", relation: "depends_on" },
      ],
    };

    const first = summarizer.buildDependencySummary({ taskId: "task_001", targetNodeId: "patch_001", traceView });
    const second = summarizer.buildDependencySummary({ taskId: "task_001", targetNodeId: "patch_001", traceView });

    expect(first.output_hash).toBe(second.output_hash);
  });

  test("ContextBenchmark winner is stable for the same input", () => {
    const benchmark = new ContextBenchmark();
    const benchmarkCase = {
      strategies: ["recent_messages", "global_summary", "dependency_chain"],
      expected_source_nodes: ["dsl_001", "plan_001", "patch_001", "sandbox_001"],
      forbidden_source_nodes: ["noise_001"],
      expected_constraints: ["frontend only"],
    };
    const options = {
      max_chars: 2000,
      contextsByStrategy: {
        recent_messages: benchmarkContext(["patch_001", "noise_001"], []),
        global_summary: benchmarkContext(["dsl_001", "plan_001"]),
        dependency_chain: benchmarkContext(["dsl_001", "plan_001", "patch_001", "sandbox_001"]),
      },
    };

    const first = benchmark.benchmarkContextStrategies(benchmarkCase, options).winner;
    const second = benchmark.benchmarkContextStrategies(benchmarkCase, options).winner;

    expect(first).toBe("dependency_chain");
    expect(second).toBe(first);
  });
});
