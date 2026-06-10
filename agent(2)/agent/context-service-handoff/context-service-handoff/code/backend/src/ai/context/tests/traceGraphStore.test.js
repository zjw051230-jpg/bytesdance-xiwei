const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventStore } = require("../eventStore");
const { TraceProjector } = require("../traceProjector");
const { TraceGraphStore } = require("../traceGraphStore");

function createHarness() {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "trace-graph-store-"));
  const eventStore = new EventStore({
    storageRoot,
    now: () => "2026-06-07T00:00:00.000Z",
    idGenerator: (() => {
      let nextId = 1;
      return () => `evt_${nextId++}`;
    })(),
  });
  const traceProjector = new TraceProjector({
    storageRoot,
    eventStore,
    now: () => "2026-06-07T00:00:00.000Z",
  });
  const traceGraphStore = new TraceGraphStore({
    eventStore,
    traceProjector,
    now: () => "2026-06-07T00:00:00.000Z",
    idGenerator: () => "edge_generated",
    maxDepth: 10,
  });
  return { eventStore, traceGraphStore };
}

function appendDependencyFixture(traceGraphStore) {
  traceGraphStore.appendTraceNode("task-1", { id: "plan_001", type: "plan", summary: "Plan" });
  traceGraphStore.appendTraceNode("task-1", { id: "patch_001", type: "patch", summary: "Patch" });
  traceGraphStore.appendTraceNode("task-1", { id: "sandbox_001", type: "sandbox_result", summary: "Failure" });
  traceGraphStore.appendTraceEdge("task-1", {
    id: "edge_patch_plan",
    from_node_id: "patch_001",
    to_node_id: "plan_001",
    relation: "depends_on",
  });
  traceGraphStore.appendTraceEdge("task-1", {
    id: "edge_sandbox_patch",
    from_node_id: "sandbox_001",
    to_node_id: "patch_001",
    relation: "depends_on",
  });
}

describe("TraceGraphStore", () => {
  test("appendTraceNode writes TRACE_NODE_APPENDED event", () => {
    const { eventStore, traceGraphStore } = createHarness();

    traceGraphStore.appendTraceNode("task-1", { id: "plan_001", type: "plan", summary: "Plan" });

    expect(eventStore.readEventsByType("task-1", "TRACE_NODE_APPENDED")).toHaveLength(1);
  });

  test("appendTraceEdge writes TRACE_EDGE_APPENDED event", () => {
    const { eventStore, traceGraphStore } = createHarness();

    traceGraphStore.appendTraceEdge("task-1", {
      id: "edge_001",
      from_node_id: "patch_001",
      to_node_id: "plan_001",
      relation: "depends_on",
    });

    expect(eventStore.readEventsByType("task-1", "TRACE_EDGE_APPENDED")).toHaveLength(1);
  });

  test("markNodeStatus writes TRACE_NODE_STATUS_CHANGED event", () => {
    const { eventStore, traceGraphStore } = createHarness();

    traceGraphStore.markNodeStatus("task-1", "plan_001", "verified");

    expect(eventStore.readEventsByType("task-1", "TRACE_NODE_STATUS_CHANGED")).toHaveLength(1);
  });

  test("getNode reads a node from rebuilt trace_view", () => {
    const { traceGraphStore } = createHarness();
    traceGraphStore.appendTraceNode("task-1", { id: "plan_001", type: "plan", summary: "Plan" });

    expect(traceGraphStore.getNode("task-1", "plan_001")).toMatchObject({
      id: "plan_001",
      type: "plan",
      summary: "Plan",
    });
  });

  test("getEdges filters by relation, from_node_id, and to_node_id", () => {
    const { traceGraphStore } = createHarness();
    appendDependencyFixture(traceGraphStore);

    expect(traceGraphStore.getEdges("task-1", { relation: "depends_on" })).toHaveLength(2);
    expect(traceGraphStore.getEdges("task-1", { from_node_id: "sandbox_001" })).toEqual([
      expect.objectContaining({ id: "edge_sandbox_patch" }),
    ]);
    expect(traceGraphStore.getEdges("task-1", { to_node_id: "plan_001" })).toEqual([
      expect.objectContaining({ id: "edge_patch_plan" }),
    ]);
  });

  test("getDependencyChain follows depends_on from child to parent dependency", () => {
    const { traceGraphStore } = createHarness();
    appendDependencyFixture(traceGraphStore);

    const chain = traceGraphStore.getDependencyChain("task-1", "sandbox_001");

    expect(chain).toMatchObject({
      target_node_id: "sandbox_001",
      depth: 2,
    });
    expect(chain.chain_nodes.map((node) => node.id)).toEqual(["sandbox_001", "patch_001", "plan_001"]);
    expect(chain.chain_edges.map((edge) => edge.id)).toEqual(["edge_sandbox_patch", "edge_patch_plan"]);
  });

  test("getDependencyChain does not reverse the depends_on direction", () => {
    const { traceGraphStore } = createHarness();
    appendDependencyFixture(traceGraphStore);

    const chain = traceGraphStore.getDependencyChain("task-1", "plan_001");

    expect(chain.chain_nodes.map((node) => node.id)).toEqual(["plan_001"]);
    expect(chain.chain_edges).toEqual([]);
  });

  test("getDependencyChain handles cyclic dependency edges without infinite traversal", () => {
    const { traceGraphStore } = createHarness();
    appendDependencyFixture(traceGraphStore);
    traceGraphStore.appendTraceEdge("task-1", {
      id: "edge_plan_sandbox",
      from_node_id: "plan_001",
      to_node_id: "sandbox_001",
      relation: "depends_on",
    });

    const chain = traceGraphStore.getDependencyChain("task-1", "sandbox_001", { maxDepth: 5 });

    expect(chain.chain_nodes.map((node) => node.id).sort()).toEqual(["patch_001", "plan_001", "sandbox_001"]);
    expect(chain.chain_edges).toHaveLength(3);
    expect(chain.depth).toBe(2);
  });

  test("appendTraceNode rejects depends_on before writing events", () => {
    const { eventStore, traceGraphStore } = createHarness();

    expect(() => traceGraphStore.appendTraceNode("task-1", {
      id: "patch_001",
      type: "patch",
      summary: "Patch",
      depends_on: ["plan_001"],
    })).toThrow(/depends_on/);

    expect(eventStore.readEvents("task-1")).toEqual([]);
  });

  test("appendTraceEdge rejects missing required fields", () => {
    const { eventStore, traceGraphStore } = createHarness();

    expect(() => traceGraphStore.appendTraceEdge("task-1", {
      from_node_id: "patch_001",
      relation: "depends_on",
    })).toThrow(/from_node_id, to_node_id, and relation/);
    expect(eventStore.readEvents("task-1")).toEqual([]);
  });
});
