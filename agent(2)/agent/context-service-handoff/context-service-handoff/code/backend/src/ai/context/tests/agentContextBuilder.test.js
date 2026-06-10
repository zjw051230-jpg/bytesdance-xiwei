const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventStore } = require("../eventStore");
const { TraceProjector } = require("../traceProjector");
const { TraceGraphStore } = require("../traceGraphStore");
const { AgentContextBuilder } = require("../agentContextBuilder");

function createHarness() {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agent-context-builder-"));
  const now = () => "2026-06-07T00:00:00.000Z";
  const eventStore = new EventStore({
    storageRoot,
    now,
    idGenerator: (() => {
      let nextId = 1;
      return () => `evt_${nextId++}`;
    })(),
  });
  const traceProjector = new TraceProjector({ eventStore, storageRoot, now });
  const traceGraphStore = new TraceGraphStore({
    eventStore,
    traceProjector,
    storageRoot,
    now,
    idGenerator: (() => {
      let nextId = 1;
      return () => `edge_${nextId++}`;
    })(),
  });
  const builder = new AgentContextBuilder({
    eventStore,
    traceProjector,
    traceGraphStore,
    storageRoot,
    now,
    idGenerator: (() => {
      let nextId = 1;
      return () => `ctx_${nextId++}`;
    })(),
  });
  seedTrace(traceGraphStore);
  return { storageRoot, eventStore, builder };
}

function seedTrace(traceGraphStore) {
  traceGraphStore.appendTraceNode("task-1", {
    id: "dsl_001",
    type: "final_dsl",
    summary: "在文章详情页显示字数统计",
    metadata: {
      constraints: ["frontend only"],
      apiKey: "sk-should-redact",
      full_chat_history: "raw chat should not appear",
    },
  });
  traceGraphStore.appendTraceNode("task-1", {
    id: "context_001",
    type: "context_package",
    summary: "Article page context",
    metadata: { target_files: ["Article.jsx"], target_snippets: ["safe snippet"] },
  });
  traceGraphStore.appendTraceNode("task-1", {
    id: "plan_001",
    type: "plan",
    summary: "只修改前端文章详情页展示逻辑",
    status: "verified",
    metadata: { target_files: ["Article.jsx"], risks: ["render risk"] },
  });
  traceGraphStore.appendTraceNode("task-1", {
    id: "patch_001",
    type: "patch",
    summary: "新增 wordCount 计算和 UI 展示",
    status: "failed",
    metadata: { full_patch_diff: "FULL_PATCH_DIFF_SHOULD_NOT_APPEAR", changed_files: ["Article.jsx"] },
  });
  traceGraphStore.appendTraceNode("task-1", {
    id: "sandbox_001",
    type: "sandbox_result",
    summary: "ReferenceError: wordCount is not defined",
    metadata: {
      likely_cause: "Repair should inspect variable scope",
      full_sandbox_log: "FULL_SANDBOX_LOG_SHOULD_NOT_APPEAR",
      authorization: "Bearer should-redact",
    },
  });
  traceGraphStore.appendTraceNode("task-1", {
    id: "interrupt_001",
    type: "interrupt_instruction",
    summary: "Do not change backend",
  });
  traceGraphStore.appendTraceEdge("task-1", {
    id: "edge_plan_dsl",
    from_node_id: "plan_001",
    to_node_id: "dsl_001",
    relation: "depends_on",
  });
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

describe("AgentContextBuilder", () => {
  test("returns different fields for planAgent, codegenAgent, repairAgent, and deliveryAgent", () => {
    const { builder } = createHarness();

    const planContext = builder.buildContextForAgent({ taskId: "task-1", agentName: "planAgent", currentNodeId: "plan_001" }).context;
    const codegenContext = builder.buildContextForAgent({ taskId: "task-1", agentName: "codegenAgent", currentNodeId: "patch_001" }).context;
    const repairContext = builder.buildContextForAgent({ taskId: "task-1", agentName: "repairAgent", currentNodeId: "sandbox_001" }).context;
    const deliveryContext = builder.buildContextForAgent({ taskId: "task-1", agentName: "deliveryAgent", currentNodeId: "sandbox_001" }).context;

    expect(planContext).toEqual(expect.objectContaining({
      final_dsl: expect.any(Object),
      requirement_summary: expect.any(Object),
      context_package_summary: expect.any(Object),
      active_constraints: expect.any(Object),
      active_interrupts: expect.any(Object),
      relevant_experiences: expect.any(Object),
      trace_summary: expect.any(Object),
    }));
    expect(codegenContext).toEqual(expect.objectContaining({
      final_dsl_core: expect.any(Object),
      verified_plan: expect.any(Object),
      target_files_summary: expect.any(Object),
      target_snippets: expect.any(Object),
      patch_constraints: expect.any(Object),
      active_interrupts: expect.any(Object),
    }));
    expect(repairContext).toEqual(expect.objectContaining({
      final_dsl_core: expect.any(Object),
      dependency_summary: expect.any(Object),
      failed_patch_summary: expect.any(Object),
      sandbox_error_summary: expect.any(Object),
      verified_plan_summary: expect.any(Object),
      repair_attempt_count: expect.any(Number),
      active_interrupts: expect.any(Object),
    }));
    expect(deliveryContext).toEqual(expect.objectContaining({
      final_dsl_summary: expect.any(Object),
      plan_summary: expect.any(Object),
      patch_summary: expect.any(Object),
      test_summary: expect.any(Object),
      risk_summary: expect.any(Object),
      evidence_list: expect.any(Object),
    }));
  });

  test("repairAgent context includes key sourced fields", () => {
    const { builder } = createHarness();

    const agentContext = builder.buildContextForAgent({
      taskId: "task-1",
      agentName: "repairAgent",
      currentNodeId: "sandbox_001",
    });

    expect(agentContext.context.dependency_summary.source_node_ids).toEqual(["sandbox_001", "patch_001", "plan_001", "dsl_001"]);
    expect(agentContext.context.sandbox_error_summary.source_node_ids).toContain("sandbox_001");
    expect(agentContext.context.failed_patch_summary.source_node_ids).toContain("patch_001");
    expect(agentContext.context.verified_plan_summary.source_node_ids).toContain("plan_001");
    expect(agentContext.context.final_dsl_core.source_node_ids).toContain("dsl_001");
    expect(agentContext.source_node_ids).toEqual(["sandbox_001", "patch_001", "plan_001", "dsl_001"]);
  });

  test("writes CONTEXT_BUILT event with metadata only and context_cache_ref", () => {
    const { eventStore, builder } = createHarness();

    builder.buildContextForAgent({ taskId: "task-1", agentName: "repairAgent", currentNodeId: "sandbox_001" });
    const event = eventStore.readEventsByType("task-1", "CONTEXT_BUILT")[0];

    expect(event.payload).toEqual(expect.objectContaining({
      context_id: "ctx_1",
      agent_name: "repairAgent",
      current_node_id: "sandbox_001",
      context_cache_ref: expect.stringContaining("context_cache/ctx_1.json"),
    }));
    expect(event.payload).not.toHaveProperty("full_context");
    expect(JSON.stringify(event.payload)).not.toContain("ReferenceError: wordCount is not defined");
  });

  test("context_cache content is privacy-filtered", () => {
    const { storageRoot, eventStore, builder } = createHarness();

    builder.buildContextForAgent({ taskId: "task-1", agentName: "repairAgent", currentNodeId: "sandbox_001" });
    const event = eventStore.readEventsByType("task-1", "CONTEXT_BUILT")[0];
    const cachedContext = JSON.parse(fs.readFileSync(path.join(storageRoot, event.payload.context_cache_ref), "utf8"));
    const cachedJson = JSON.stringify(cachedContext);

    expect(cachedJson).toContain("[REDACTED]");
    expect(cachedJson).not.toContain("sk-should-redact");
    expect(cachedJson).not.toContain("Bearer should-redact");
  });

  test("raw full fields do not enter returned AgentContext", () => {
    const { builder } = createHarness();

    const agentContext = builder.buildContextForAgent({
      taskId: "task-1",
      agentName: "repairAgent",
      currentNodeId: "sandbox_001",
    });
    const json = JSON.stringify(agentContext.context);

    expect(json).not.toContain("full_chat_history");
    expect(json).not.toContain("FULL_SANDBOX_LOG_SHOULD_NOT_APPEAR");
    expect(json).not.toContain("FULL_PATCH_DIFF_SHOULD_NOT_APPEAR");
  });

  test("CONTEXT_BUILT event source ids trace dependency chain nodes", () => {
    const { eventStore, builder } = createHarness();

    builder.buildContextForAgent({ taskId: "task-1", agentName: "repairAgent", currentNodeId: "sandbox_001" });
    const event = eventStore.readEventsByType("task-1", "CONTEXT_BUILT")[0];

    expect(event.payload.source_node_ids).toEqual(["sandbox_001", "patch_001", "plan_001", "dsl_001"]);
    expect(event.payload.source_event_ids.length).toBeGreaterThan(0);
  });
});
