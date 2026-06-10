const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  EventStore,
  IdempotencyConflictError,
  OptimisticConcurrencyError,
} = require("../eventStore");

function createStore() {
  return new EventStore({
    storageRoot: fs.mkdtempSync(path.join(os.tmpdir(), "trace-event-store-")),
    now: () => "2026-06-07T00:00:00.000Z",
    idGenerator: (() => {
      let nextId = 1;
      return () => `evt_${nextId++}`;
    })(),
  });
}

describe("EventStore", () => {
  test("appends events in seq order and reads them back by task", () => {
    const eventStore = createStore();

    const first = eventStore.appendEvent("task-1", {
      type: "TRACE_NODE_APPENDED",
      producer: "test",
      payload: { node: { id: "node-1", type: "plan", summary: "Plan" } },
    });
    const second = eventStore.appendEvent("task-1", {
      type: "TRACE_EDGE_APPENDED",
      producer: "test",
      payload: { edge: { id: "edge-1", from_node_id: "node-2", to_node_id: "node-1", relation: "depends_on" } },
    });

    expect(first).toMatchObject({
      event_id: "evt_1",
      task_id: "task-1",
      seq: 1,
      created_at: "2026-06-07T00:00:00.000Z",
      schema_version: "1",
    });
    expect(second.seq).toBe(2);
    expect(eventStore.readEvents("task-1").map((event) => event.event_id)).toEqual(["evt_1", "evt_2"]);
  });

  test("reads latest seq and filters events by type", () => {
    const eventStore = createStore();

    eventStore.appendEvent("task-1", { type: "TRACE_NODE_APPENDED", payload: { id: "node-1" } });
    eventStore.appendEvent("task-1", { type: "TRACE_NODE_STATUS_CHANGED", payload: { node_id: "node-1", status: "active" } });

    expect(eventStore.getLatestEventSeq("task-1")).toBe(2);
    expect(eventStore.readEventsByType("task-1", "TRACE_NODE_STATUS_CHANGED")).toHaveLength(1);
  });

  test("returns the existing event for the same idempotency key and payload", () => {
    const eventStore = createStore();
    const event = {
      type: "TRACE_NODE_APPENDED",
      idempotency_key: "append-node-1",
      payload: { node: { id: "node-1", type: "plan", summary: "Plan" } },
    };

    const first = eventStore.appendEvent("task-1", event);
    const second = eventStore.appendEvent("task-1", event);

    expect(second).toEqual(first);
    expect(eventStore.readEvents("task-1")).toHaveLength(1);
  });

  test("throws IdempotencyConflictError for the same idempotency key and different payload", () => {
    const eventStore = createStore();

    eventStore.appendEvent("task-1", {
      type: "TRACE_NODE_APPENDED",
      idempotency_key: "append-node-1",
      payload: { node: { id: "node-1", type: "plan", summary: "Plan" } },
    });

    expect(() => eventStore.appendEvent("task-1", {
      type: "TRACE_NODE_APPENDED",
      idempotency_key: "append-node-1",
      payload: { node: { id: "node-1", type: "patch", summary: "Patch" } },
    })).toThrow(IdempotencyConflictError);
  });

  test("throws OptimisticConcurrencyError when expectedSeq does not match latest seq", () => {
    const eventStore = createStore();

    eventStore.appendEvent("task-1", {
      type: "TRACE_NODE_APPENDED",
      payload: { node: { id: "node-1", type: "plan", summary: "Plan" } },
    });

    expect(() => eventStore.appendEvent(
      "task-1",
      { type: "TRACE_NODE_APPENDED", payload: { node: { id: "node-2", type: "patch", summary: "Patch" } } },
      { expectedSeq: 0 },
    )).toThrow(OptimisticConcurrencyError);
  });

  test("readEvents returns raw events while readSafeEvents applies redaction overlay", () => {
    const eventStore = createStore();
    const event = eventStore.appendEvent("task-1", {
      type: "DSL_FINALIZED",
      payload: { summary: "safe", secret: "sk-secret-value" },
    });
    eventStore.redactionManifestStore.createRedactionManifest("task-1", {
      affected_event_ids: [event.event_id],
      redacted_paths: ["payload.secret"],
      reason: "secret_leak",
    });

    expect(eventStore.readEvents("task-1")[0].payload.secret).toBe("sk-secret-value");
    expect(eventStore.readSafeEvents("task-1")[0].payload.secret).toBe("[REDACTED]");
  });

  test("readSafeEvents does not mutate raw events", () => {
    const eventStore = createStore();
    const event = eventStore.appendEvent("task-1", {
      type: "DSL_FINALIZED",
      payload: { secret: "sk-secret-value" },
    });
    eventStore.redactionManifestStore.createRedactionManifest("task-1", {
      affected_event_ids: [event.event_id],
      redacted_paths: ["payload.secret"],
      reason: "secret_leak",
    });

    const safeEvent = eventStore.readSafeEvents("task-1")[0];
    safeEvent.payload.secret = "mutated";

    expect(eventStore.readEvents("task-1")[0].payload.secret).toBe("sk-secret-value");
  });

  test("readSafeEvents returns stable equivalent copies when no manifest exists", () => {
    const eventStore = createStore();
    eventStore.appendEvent("task-1", {
      type: "DSL_FINALIZED",
      payload: { summary: "safe" },
    });

    const rawEvents = eventStore.readEvents("task-1");
    const firstSafeEvents = eventStore.readSafeEvents("task-1");
    const secondSafeEvents = eventStore.readSafeEvents("task-1");

    expect(firstSafeEvents).toEqual(rawEvents);
    expect(secondSafeEvents).toEqual(firstSafeEvents);
    expect(firstSafeEvents).not.toBe(rawEvents);
    expect(firstSafeEvents[0]).not.toBe(rawEvents[0]);
  });

  test("readSafeEvents output no longer contains manifest-redacted secrets", () => {
    const eventStore = createStore();
    const event = eventStore.appendEvent("task-1", {
      type: "DSL_FINALIZED",
      payload: { secret: "sk-secret-value" },
    });
    eventStore.redactionManifestStore.createRedactionManifest("task-1", {
      affected_event_ids: [event.event_id],
      redacted_paths: ["payload.secret"],
      reason: "secret_leak",
    });

    expect(JSON.stringify(eventStore.readSafeEvents("task-1"))).not.toContain("sk-secret-value");
  });
});
