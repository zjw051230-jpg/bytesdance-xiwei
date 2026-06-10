const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventStore } = require("../eventStore");
const { TraceProjector } = require("../traceProjector");
const { TraceGraphStore } = require("../traceGraphStore");
const { mapContextEventForAppend } = require("../contextEventMapper");

let cleanupRoots = [];

afterEach(() => {
  for (const root of cleanupRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  cleanupRoots = [];
});

function tempStorageRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "context-event-mapper-"));
  cleanupRoots.push(root);
  return root;
}

function createHarness() {
  const storageRoot = tempStorageRoot();
  let nextEventId = 1;
  const eventStore = new EventStore({
    storageRoot,
    now: () => "2026-06-07T00:00:00.000Z",
    idGenerator: () => `evt_${nextEventId++}`,
  });
  const traceProjector = new TraceProjector({
    eventStore,
    storageRoot,
    now: () => "2026-06-07T00:00:00.000Z",
  });
  const traceGraphStore = new TraceGraphStore({
    eventStore,
    traceProjector,
    storageRoot,
  });
  return { eventStore, traceProjector, traceGraphStore };
}

function appendMapped(eventStore, taskId, event) {
  const mappedEvents = mapContextEventForAppend({
    taskId,
    event,
    existingEvents: eventStore.readEvents(taskId),
  });
  return mappedEvents.map((mappedEvent) => eventStore.appendEvent(
    taskId,
    mappedEvent,
    { expectedSeq: eventStore.getLatestEventSeq(taskId) },
  ));
}

function pythonEvent(type, spanId, parentSpanId, payload = {}) {
  return {
    type,
    category: "domain_event",
    producer: producerFor(type),
    trace_id: "task-python",
    span_id: spanId,
    parent_span_id: parentSpanId,
    run_id: "run_task-python",
    payload,
    idempotency_key: `${type}:task-python:${spanId}`,
  };
}

function producerFor(type) {
  return {
    PLAN_CREATED: "planAgent",
    PATCH_GENERATED: "codegenAgent",
    REVIEW_COMPLETED: "deliveryAgent",
    EXECUTION_COMPLETED: "repairAgent",
    VERIFICATION_COMPLETED: "deliveryAgent",
    TASK_FINISHED: "deliveryAgent",
  }[type];
}

describe("contextEventMapper", () => {
  test("maps Python plan event into task, DSL, and plan events", () => {
    const mapped = mapContextEventForAppend({
      taskId: "task-python",
      existingEvents: [],
      event: pythonEvent("PLAN_CREATED", "plan_2", null, {
        plan: {
          task_name: "Add article word stats",
          steps: ["Locate page", "Render stats"],
          target_files_hint: ["frontend/src/pages/Article.jsx"],
        },
      }),
    });

    expect(mapped.map((event) => event.type)).toEqual(["TASK_CREATED", "DSL_FINALIZED", "PLAN_CREATED"]);
    expect(mapped[2].payload).toMatchObject({
      plan_node_id: "plan_2",
      depends_on_node_ids: ["dsl_root"],
    });
    expect(mapped[0]).not.toHaveProperty("seq");
    expect(mapped[0]).not.toHaveProperty("event_id");
  });

  test("maps Python patch, review, execution, verification, and finish event types", () => {
    expect(mapContextEventForAppend({
      taskId: "task-python",
      event: pythonEvent("PATCH_GENERATED", "patch_4", "plan_2", { patch_plan: { summary: "Patch summary" } }),
    }).map((event) => event.type)).toEqual(["PATCH_CREATED"]);

    expect(mapContextEventForAppend({
      taskId: "task-python",
      event: pythonEvent("REVIEW_COMPLETED", "review_5", "patch_4", { review: { approved: true } }),
    }).map((event) => event.type)).toEqual(["TRACE_NODE_APPENDED", "TRACE_EDGE_APPENDED"]);

    expect(mapContextEventForAppend({
      taskId: "task-python",
      event: pythonEvent("EXECUTION_COMPLETED", "sandbox_6", "review_5", { execution_result: { executed: true } }),
    }).map((event) => event.type)).toEqual(["SANDBOX_RESULT_RECORDED"]);

    expect(mapContextEventForAppend({
      taskId: "task-python",
      event: pythonEvent("VERIFICATION_COMPLETED", "verify_7", "sandbox_6", { verification_result: { passed: true } }),
    }).map((event) => event.type)).toEqual(["TRACE_NODE_APPENDED", "TRACE_EDGE_APPENDED"]);

    expect(mapContextEventForAppend({
      taskId: "task-python",
      event: pythonEvent("TASK_FINISHED", "finish_8", "verify_7", { final_summary: { status: "SUCCESS" } }),
    }).map((event) => event.type)).toEqual(["TRACE_NODE_APPENDED", "TRACE_EDGE_APPENDED"]);
  });

  test("projects a Python runtime event chain into dependency graph nodes with matching span ids", () => {
    const { eventStore, traceGraphStore } = createHarness();
    const taskId = "task-python";

    appendMapped(eventStore, taskId, pythonEvent("PLAN_CREATED", "plan_2", null, {
      plan: { task_name: "Add article word stats" },
    }));
    appendMapped(eventStore, taskId, pythonEvent("PATCH_GENERATED", "patch_4", "plan_2", {
      patch_plan: { summary: "Patch article page", patches: [{ file: "frontend/src/pages/Article.jsx" }] },
    }));
    appendMapped(eventStore, taskId, pythonEvent("REVIEW_COMPLETED", "review_5", "patch_4", {
      review: { approved: true, summary: "Review passed" },
    }));
    appendMapped(eventStore, taskId, pythonEvent("EXECUTION_COMPLETED", "sandbox_6", "review_5", {
      execution_result: { executed: true, summary: "Mock execution completed" },
    }));

    const dependencyChain = traceGraphStore.getDependencyChain(taskId, "sandbox_6");

    expect(dependencyChain.chain_nodes.map((node) => node.id)).toEqual([
      "sandbox_6",
      "review_5",
      "patch_4",
      "plan_2",
      "dsl_root",
    ]);
    expect(dependencyChain.chain_nodes.map((node) => node.type)).toEqual([
      "sandbox_result",
      "review",
      "patch",
      "plan",
      "final_dsl",
    ]);
    expect(dependencyChain.chain_edges).toHaveLength(4);
  });
});
