const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const contextService = require("../index");
const { EventStore } = require("../eventStore");
const { TraceProjector } = require("../traceProjector");
const { TraceGraphStore } = require("../traceGraphStore");
const { AgentContextBuilder } = require("../agentContextBuilder");

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

function createHarness(prefix = "context-contract-") {
  const storageRoot = tempStorageRoot(prefix);
  const now = () => "2026-06-07T00:00:00.000Z";
  let nextEventId = 1;
  let nextContextId = 1;
  const eventStore = new EventStore({
    storageRoot,
    now,
    idGenerator: () => `evt_${nextEventId++}`,
  });
  const traceProjector = new TraceProjector({ eventStore, storageRoot, now });
  const traceGraphStore = new TraceGraphStore({
    eventStore,
    traceProjector,
    storageRoot,
    now,
    idGenerator: (prefixName) => `${prefixName}_001`,
  });
  const agentContextBuilder = new AgentContextBuilder({
    eventStore,
    traceProjector,
    traceGraphStore,
    storageRoot,
    now,
    idGenerator: (prefixName) => `${prefixName}_${nextContextId++}`,
  });

  return { storageRoot, eventStore, traceProjector, traceGraphStore, agentContextBuilder };
}

function seedRepairTrace(traceGraphStore, taskId) {
  traceGraphStore.appendTraceNode(taskId, {
    id: "dsl_001",
    type: "final_dsl",
    summary: "Final DSL",
    status: "verified",
  });
  traceGraphStore.appendTraceNode(taskId, {
    id: "plan_001",
    type: "plan",
    summary: "Verified plan",
    status: "verified",
  });
  traceGraphStore.appendTraceNode(taskId, {
    id: "patch_001",
    type: "patch",
    summary: "Failed patch",
    status: "failed",
  });
  traceGraphStore.appendTraceNode(taskId, {
    id: "sandbox_001",
    type: "sandbox_result",
    summary: "ReferenceError: wordCount is not defined",
    status: "failed",
  });
  traceGraphStore.appendTraceEdge(taskId, {
    id: "edge_plan_dsl",
    from_node_id: "plan_001",
    to_node_id: "dsl_001",
    relation: "depends_on",
  });
  traceGraphStore.appendTraceEdge(taskId, {
    id: "edge_patch_plan",
    from_node_id: "patch_001",
    to_node_id: "plan_001",
    relation: "depends_on",
  });
  traceGraphStore.appendTraceEdge(taskId, {
    id: "edge_sandbox_patch",
    from_node_id: "sandbox_001",
    to_node_id: "patch_001",
    relation: "depends_on",
  });
}

describe("Context Service contract", () => {
  test("public index exports only core Context Service APIs", () => {
    expect(Object.keys(contextService).sort()).toEqual([
      "agentContextBuilder",
      "compactSummarizer",
      "contextBenchmark",
      "contextBudgetManager",
      "contextEvalRunner",
      "eventStore",
      "privacyFilter",
      "redactionManifest",
      "traceGraphStore",
      "traceProjector",
    ]);
  });

  test("public index does not export deleted execution-layer concepts", () => {
    const exportedNames = JSON.stringify(Object.keys(contextService));
    const forbiddenFragments = [
      "Run" + "time",
      "Ho" + "ok",
      "Runtime" + "Decision",
      "Diagnostic" + "Event",
      "Access" + "Policy",
    ];

    for (const fragment of forbiddenFragments) {
      expect(exportedNames).not.toContain(fragment);
    }
  });

  test("TraceNode rejects depends_on and does not write an event", () => {
    const taskId = "task_contract_node";
    const { eventStore, traceGraphStore } = createHarness();

    expect(() =>
      traceGraphStore.appendTraceNode(taskId, {
        id: "node_001",
        type: "plan",
        summary: "Bad node",
        depends_on: ["dsl_001"],
      })
    ).toThrow(/depends_on/);
    expect(eventStore.readEvents(taskId)).toEqual([]);
  });

  test("TraceEdge is the dependency source and direction is child to parent", () => {
    const taskId = "task_contract_edge";
    const { traceGraphStore } = createHarness();
    traceGraphStore.appendTraceNode(taskId, {
      id: "parent_001",
      type: "final_dsl",
      summary: "Parent dependency",
    });
    traceGraphStore.appendTraceNode(taskId, {
      id: "child_001",
      type: "plan",
      summary: "Child node",
    });
    traceGraphStore.appendTraceEdge(taskId, {
      id: "edge_child_parent",
      from_node_id: "child_001",
      to_node_id: "parent_001",
      relation: "depends_on",
    });

    const dependencyChain = traceGraphStore.getDependencyChain(taskId, "child_001");

    expect(dependencyChain.chain_nodes.map((node) => node.id)).toEqual(["child_001", "parent_001"]);
    expect(dependencyChain.chain_edges).toEqual([
      expect.objectContaining({
        from_node_id: "child_001",
        to_node_id: "parent_001",
        relation: "depends_on",
      }),
    ]);
  });

  test("CONTEXT_BUILT contains metadata only and AgentContext fields carry source_node_ids", () => {
    const taskId = "task_contract_context";
    const { eventStore, traceGraphStore, agentContextBuilder } = createHarness();
    seedRepairTrace(traceGraphStore, taskId);

    const agentContext = agentContextBuilder.buildContextForAgent({
      taskId,
      agentName: "repairAgent",
      currentNodeId: "sandbox_001",
    });
    const contextBuilt = eventStore.readEventsByType(taskId, "CONTEXT_BUILT")[0];

    expect(contextBuilt.payload).not.toHaveProperty("full_context");
    expect(agentContext.context.dependency_summary.source_node_ids).toEqual([
      "sandbox_001",
      "patch_001",
      "plan_001",
      "dsl_001",
    ]);
    expect(agentContext.context.failed_patch_summary.source_node_ids).toContain("patch_001");
    expect(agentContext.context.sandbox_error_summary.source_node_ids).toContain("sandbox_001");
    expect(agentContext.context.verified_plan_summary.source_node_ids).toContain("plan_001");
    expect(agentContext.context.final_dsl_core.source_node_ids).toContain("dsl_001");
  });

  test("README and CONTRACTS do not describe deleted modules as current implementation", () => {
    const readme = fs.readFileSync(path.join(__dirname, "../README.md"), "utf8");
    const contracts = fs.readFileSync(path.join(__dirname, "../CONTRACTS.md"), "utf8");
    const docs = `${readme}\n${contracts}`;

    expect(docs).not.toContain("hookFailure");
    expect(docs).not.toContain("hookRuntime");
    expect(docs).not.toContain("RuntimeDecision");
    expect(docs).not.toContain("DiagnosticEvent");
    expect(docs).not.toContain("AccessPolicy");
  });
});
