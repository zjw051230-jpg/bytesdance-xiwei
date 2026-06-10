const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventStore } = require("../eventStore");
const { TraceProjector } = require("../traceProjector");
const { TraceGraphStore } = require("../traceGraphStore");
const { AgentContextBuilder } = require("../agentContextBuilder");
const { ContextEvalRunner } = require("../contextEvalRunner");
const { ContextBenchmark } = require("../contextBenchmark");
const { RedactionManifestStore } = require("../redactionManifest");

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

function createHarness(prefix = "context-failure-") {
  const storageRoot = tempStorageRoot(prefix);
  const now = () => "2026-06-07T00:00:00.000Z";
  let nextEventId = 1;
  let nextContextId = 1;
  const redactionManifestStore = new RedactionManifestStore({ storageRoot, now });
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
    projectorVersion: "context-failure-v1",
  });
  const traceGraphStore = new TraceGraphStore({ eventStore, traceProjector, storageRoot, now });
  const agentContextBuilder = new AgentContextBuilder({
    eventStore,
    traceProjector,
    traceGraphStore,
    storageRoot,
    now,
    idGenerator: (prefixName) => `${prefixName}_${nextContextId++}`,
  });
  return { eventStore, traceProjector, traceGraphStore, agentContextBuilder, redactionManifestStore };
}

describe("Context Service failure modes", () => {
  test("unknown event type is reported without crashing projection", () => {
    const taskId = "task_failure_unknown_event";
    const { eventStore, traceProjector } = createHarness();
    eventStore.appendEvent(taskId, { type: "UNKNOWN_EVENT_TYPE", payload: { value: true } });

    const result = traceProjector.rebuildTraceView(taskId);

    expect(result.trace_view.nodes).toEqual([]);
    expect(result.projection_report.errors).toEqual([
      expect.objectContaining({ error_type: "unsupported_event_type", severity: "warning" }),
    ]);
  });

  test("missing node status change enters projection_report", () => {
    const taskId = "task_failure_missing_node";
    const { eventStore, traceProjector } = createHarness();
    eventStore.appendEvent(taskId, {
      type: "TRACE_NODE_STATUS_CHANGED",
      payload: { node_id: "missing_node", status: "failed" },
    });

    const result = traceProjector.rebuildTraceView(taskId);

    expect(result.projection_report.errors).toEqual([
      expect.objectContaining({ error_type: "missing_node" }),
    ]);
  });

  test("illegal status transition is reported and does not pollute trace_view", () => {
    const taskId = "task_failure_illegal_status";
    const { eventStore, traceProjector } = createHarness();
    eventStore.appendEvent(taskId, {
      type: "TRACE_NODE_APPENDED",
      payload: { node: { id: "node_001", type: "sandbox_result", summary: "Sandbox", status: "created" } },
    });
    eventStore.appendEvent(taskId, {
      type: "TRACE_NODE_STATUS_CHANGED",
      payload: { node_id: "node_001", status: "failed" },
    });
    eventStore.appendEvent(taskId, {
      type: "TRACE_NODE_STATUS_CHANGED",
      payload: { node_id: "node_001", status: "verified" },
    });

    const result = traceProjector.rebuildTraceView(taskId);

    expect(result.trace_view.nodes[0]).toMatchObject({ id: "node_001", status: "failed" });
    expect(result.projection_report.errors).toEqual([
      expect.objectContaining({ error_type: "invalid_status_transition" }),
    ]);
  });

  test("duplicate node and edge are reported without crashing", () => {
    const taskId = "task_failure_duplicate";
    const { eventStore, traceProjector } = createHarness();
    eventStore.appendEvent(taskId, {
      type: "TRACE_NODE_APPENDED",
      payload: { node: { id: "node_001", type: "plan", summary: "Plan" } },
    });
    eventStore.appendEvent(taskId, {
      type: "TRACE_NODE_APPENDED",
      payload: { node: { id: "node_001", type: "plan", summary: "Duplicate plan" } },
    });
    eventStore.appendEvent(taskId, {
      type: "TRACE_EDGE_APPENDED",
      payload: {
        edge: { id: "edge_001", from_node_id: "node_001", to_node_id: "node_001", relation: "depends_on" },
      },
    });
    eventStore.appendEvent(taskId, {
      type: "TRACE_EDGE_APPENDED",
      payload: {
        edge: { id: "edge_001", from_node_id: "node_001", to_node_id: "node_001", relation: "depends_on" },
      },
    });

    const result = traceProjector.rebuildTraceView(taskId);

    expect(result.trace_view.nodes).toHaveLength(1);
    expect(result.trace_view.edges).toHaveLength(1);
    expect(result.projection_report.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ error_type: "duplicate_node" }),
      expect.objectContaining({ error_type: "duplicate_edge" }),
    ]));
  });

  test("missing redaction path is skipped safely", () => {
    const taskId = "task_failure_redaction_path";
    const { eventStore, redactionManifestStore } = createHarness();
    const event = eventStore.appendEvent(taskId, {
      type: "TASK_CREATED",
      payload: { summary: "safe" },
    });
    redactionManifestStore.createRedactionManifest(taskId, {
      affected_event_ids: [event.event_id],
      redacted_paths: ["payload.does.not.exist"],
      reason: "secret_leak",
    });

    expect(() => eventStore.readSafeEvents(taskId)).not.toThrow();
    expect(eventStore.readSafeEvents(taskId)[0].payload.summary).toBe("safe");
  });

  test("empty events rebuild an empty trace_view", () => {
    const { traceProjector } = createHarness();

    const result = traceProjector.rebuildTraceView("task_failure_empty_events");

    expect(result.trace_view.nodes).toEqual([]);
    expect(result.trace_view.edges).toEqual([]);
    expect(result.projection_report.errors).toEqual([]);
  });

  test("empty trace graph returns null node and empty dependency chain", () => {
    const { traceGraphStore } = createHarness();

    expect(traceGraphStore.getNode("task_failure_empty_graph", "missing_node")).toBeNull();
    expect(traceGraphStore.getDependencyChain("task_failure_empty_graph", "missing_node")).toEqual({
      target_node_id: "missing_node",
      chain_nodes: [],
      chain_edges: [],
      depth: 0,
    });
  });

  test("buildContextForAgent with missing currentNodeId returns safe default context", () => {
    const { agentContextBuilder } = createHarness();

    const agentContext = agentContextBuilder.buildContextForAgent({
      taskId: "task_failure_missing_context_node",
      agentName: "repairAgent",
      currentNodeId: "missing_node",
    });

    expect(agentContext.source_node_ids).toEqual([]);
    expect(agentContext.context.dependency_summary.source_node_ids).toEqual([]);
    expect(agentContext.context.final_dsl_core.value).toEqual([]);
  });

  test("ContextEvalRunner empty expected nodes and missing quality metrics do not produce NaN", () => {
    const runner = new ContextEvalRunner();

    const evalResult = runner.runContextEvalCase({
      context: { source_node_ids: [], context: {} },
      expected_source_nodes: [],
      forbidden_source_nodes: [],
      expected_constraints: [],
      expected_attributions: [],
    });
    const qualityReport = runner.calculateContextQualityReport({});

    expect(evalResult.metrics.dependency_recall).toBe(1);
    for (const score of Object.values(qualityReport)) {
      expect(Number.isNaN(score)).toBe(false);
    }
  });

  test("ContextBenchmark gives a clear error for missing strategy context", () => {
    const benchmark = new ContextBenchmark();

    expect(() =>
      benchmark.benchmarkContextStrategies(
        {
          strategies: ["recent_messages", "dependency_chain"],
          expected_source_nodes: ["dsl_001"],
        },
        {
          contextsByStrategy: {
            recent_messages: { source_node_ids: [], context: {} },
          },
        }
      )
    ).toThrow(/Missing context/);
  });
});
