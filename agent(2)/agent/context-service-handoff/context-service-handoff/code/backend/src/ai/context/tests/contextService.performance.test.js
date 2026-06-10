const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
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

function createHarness(scale) {
  const storageRoot = tempStorageRoot(`context-performance-${scale}-`);
  const now = () => "2026-06-07T00:00:00.000Z";
  let nextEventId = 1;
  let nextContextId = 1;
  const eventStore = new EventStore({
    storageRoot,
    now,
    idGenerator: () => `evt_${nextEventId++}`,
  });
  const traceProjector = new TraceProjector({
    eventStore,
    storageRoot,
    now,
    projectorVersion: `context-performance-${scale}`,
  });
  const traceGraphStore = new TraceGraphStore({
    eventStore,
    traceProjector,
    storageRoot,
    now,
  });
  const agentContextBuilder = new AgentContextBuilder({
    eventStore,
    traceProjector,
    traceGraphStore,
    storageRoot,
    now,
    idGenerator: (prefixName) => `${prefixName}_${nextContextId++}`,
  });

  return { eventStore, traceProjector, traceGraphStore, agentContextBuilder };
}

function measure(operation) {
  const started = performance.now();
  const value = operation();
  return {
    value,
    duration_ms: Math.round((performance.now() - started) * 1000) / 1000,
  };
}

function appendMeasuredTaskEvents(eventStore, taskId, scale) {
  const result = measure(() => {
    eventStore.appendEvent(taskId, {
      type: "TASK_CREATED",
      payload: {
        summary: "Performance baseline task",
        requirement: "Measure Context Service baseline operations.",
      },
    });
    eventStore.appendEvent(taskId, {
      type: "DSL_FINALIZED",
      payload: {
        dsl_node_id: "dsl_001",
        summary: "Final DSL",
      },
    });
    eventStore.appendEvent(taskId, {
      type: "PLAN_CREATED",
      payload: {
        plan_node_id: "plan_001",
        summary: "Plan",
        status: "verified",
        depends_on_node_ids: ["dsl_001"],
      },
    });
    eventStore.appendEvent(taskId, {
      type: "PATCH_CREATED",
      payload: {
        patch_node_id: "patch_001",
        summary: "Patch",
        status: "failed",
        depends_on_plan_node_id: "plan_001",
      },
    });
    eventStore.appendEvent(taskId, {
      type: "SANDBOX_RESULT_RECORDED",
      payload: {
        sandbox_node_id: "sandbox_001",
        summary: "ReferenceError: wordCount is not defined",
        success: false,
        patch_node_id: "patch_001",
      },
    });

    for (let index = 5; index < scale; index += 1) {
      eventStore.appendEvent(taskId, {
        type: "TASK_CREATED",
        payload: {
          summary: `Filler audit event ${index}`,
        },
      });
    }
  });

  return result.duration_ms;
}

describe("Context Service performance baseline", () => {
  test("records baseline durations for 100, 1000, and 5000 events without hard thresholds", () => {
    const scales = [100, 1000, 5000];
    const baseline = [];

    for (const scale of scales) {
      const taskId = `task_performance_${scale}`;
      const { eventStore, traceProjector, traceGraphStore, agentContextBuilder } = createHarness(scale);
      const appendDurationMs = appendMeasuredTaskEvents(eventStore, taskId, scale);

      const projection = measure(() => traceProjector.rebuildTraceView(taskId));
      const dependencyChain = measure(() => traceGraphStore.getDependencyChain(taskId, "sandbox_001"));
      const agentContext = measure(() =>
        agentContextBuilder.buildContextForAgent({
          taskId,
          agentName: "repairAgent",
          currentNodeId: "sandbox_001",
        })
      );
      const safeEvents = measure(() => eventStore.readSafeEvents(taskId));

      baseline.push({
        scale,
        appendEvent_duration_ms: appendDurationMs,
        rebuildTraceView_duration_ms: projection.duration_ms,
        getDependencyChain_duration_ms: dependencyChain.duration_ms,
        buildContextForAgent_duration_ms: agentContext.duration_ms,
        readSafeEvents_duration_ms: safeEvents.duration_ms,
      });

      expect(eventStore.readEvents(taskId).length).toBe(scale + 1);
      expect(projection.value.trace_view.nodes.map((node) => node.id)).toEqual([
        "dsl_001",
        "patch_001",
        "plan_001",
        "sandbox_001",
      ]);
      expect(dependencyChain.value.chain_nodes.map((node) => node.id)).toEqual([
        "sandbox_001",
        "patch_001",
        "plan_001",
        "dsl_001",
      ]);
      expect(agentContext.value.context.dependency_summary.source_node_ids).toEqual([
        "sandbox_001",
        "patch_001",
        "plan_001",
        "dsl_001",
      ]);
      expect(safeEvents.value).toHaveLength(scale + 1);
    }

    for (const result of baseline) {
      for (const [key, value] of Object.entries(result)) {
        if (key.endsWith("_duration_ms")) {
          expect(Number.isFinite(value)).toBe(true);
          expect(value).toBeGreaterThanOrEqual(0);
        }
      }
    }
  }, 120000);
});
