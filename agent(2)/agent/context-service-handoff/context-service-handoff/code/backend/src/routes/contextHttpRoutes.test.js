const express = require("express");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { RedactionManifestStore } = require("../ai/context/redactionManifest");
const { createContextHttpRouter } = require("./contextHttpRoutes");

const servers = [];
const cleanupRoots = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
  for (const root of cleanupRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

async function createHarness() {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "context-http-wrapper-"));
  cleanupRoots.push(storageRoot);

  const app = express();
  app.use(express.json());
  app.use(createContextHttpRouter({ storageRoot }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  servers.push(server);
  const { port } = server.address();

  async function request(method, route, body) {
    const response = await fetch(`http://127.0.0.1:${port}${route}`, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json();
    return { status: response.status, data };
  }

  return {
    request,
    storageRoot,
    redactionManifestStore: new RedactionManifestStore({
      storageRoot,
      now: () => "2026-06-07T00:00:00.000Z",
      idGenerator: () => "redact_001",
    }),
  };
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
  }[type];
}

async function appendPythonEvent(request, taskId, event, expectedSeq = 0) {
  return request("POST", "/events/append", { taskId, event, expectedSeq });
}

describe("Context HTTP wrapper", () => {
  test("exposes root and api context health endpoints", async () => {
    const { request } = await createHarness();

    const rootHealth = await request("GET", "/context/health");
    const apiHealth = await request("GET", "/api/context/health");

    expect(rootHealth.status).toBe(200);
    expect(apiHealth.status).toBe(200);
    expect(rootHealth.data).toMatchObject({ ok: true, service: "context-http-wrapper" });
    expect(apiHealth.data).toMatchObject({ ok: true, service: "context-http-wrapper" });
  });

  test("appends Python events and returns top-level event metadata", async () => {
    const { request } = await createHarness();
    const response = await appendPythonEvent(request, "task-python", pythonEvent("PLAN_CREATED", "plan_2", null, {
      plan: { task_name: "Add article word stats" },
    }));

    expect(response.status).toBe(201);
    expect(response.data).toMatchObject({
      ok: true,
      event_id: expect.any(String),
      seq: 3,
      latest_seq: 3,
      event: expect.objectContaining({ type: "PLAN_CREATED" }),
    });
    expect(response.data.appended_events.map((event) => event.type)).toEqual([
      "TASK_CREATED",
      "DSL_FINALIZED",
      "PLAN_CREATED",
    ]);
  });

  test("returns latest seq and safe redacted events", async () => {
    const { request, redactionManifestStore } = await createHarness();
    const appendResponse = await appendPythonEvent(request, "task-python", pythonEvent("PLAN_CREATED", "plan_2", null, {
      plan: {
        task_name: "Do not leak",
        metadata: { secret: "sk-wrapper-secret123" },
      },
    }));
    const leakedEventId = appendResponse.data.appended_events[2].event_id;
    redactionManifestStore.createRedactionManifest("task-python", {
      affected_event_ids: [leakedEventId],
      redacted_paths: ["payload.metadata.plan.metadata.secret"],
      reason: "secret_leak",
    });

    const latest = await request("GET", "/events/latest-seq/task-python");
    const safeEvents = await request("GET", "/events/safe/task-python");

    expect(latest.data).toMatchObject({ ok: true, latest_seq: 3 });
    expect(JSON.stringify(safeEvents.data.events)).toContain("[REDACTED]");
    expect(JSON.stringify(safeEvents.data.events)).not.toContain("sk-wrapper-secret123");
  });

  test("builds repair context over a Python event chain and tolerates stale client expectedSeq", async () => {
    const { request } = await createHarness();
    const taskId = "task-python";

    const plan = await appendPythonEvent(request, taskId, pythonEvent("PLAN_CREATED", "plan_2", null, {
      plan: { task_name: "Add article word stats", target_files_hint: ["frontend/src/pages/Article.jsx"] },
    }), 0);
    expect(plan.data.latest_seq).toBe(3);

    const planContext = await request("POST", "/context/build", {
      taskId,
      agentName: "planAgent",
      currentNodeId: "plan_2",
    });
    expect(planContext.status).toBe(200);
    expect(planContext.data.latest_seq).toBe(4);

    const patch = await appendPythonEvent(request, taskId, pythonEvent("PATCH_GENERATED", "patch_4", "plan_2", {
      patch_plan: {
        summary: "Patch article page",
        patches: [{ file: "frontend/src/pages/Article.jsx", changes: ["Render word stats"] }],
      },
    }), 3);
    expect(patch.status).toBe(201);
    expect(patch.data.latest_seq).toBe(5);

    await appendPythonEvent(request, taskId, pythonEvent("REVIEW_COMPLETED", "review_5", "patch_4", {
      review: { approved: true, summary: "Review passed" },
    }), 5);
    await appendPythonEvent(request, taskId, pythonEvent("EXECUTION_COMPLETED", "sandbox_6", "review_5", {
      execution_result: { executed: false, summary: "ReferenceError: wordCount is not defined" },
    }), 7);

    const trace = await request("POST", "/trace/rebuild", { taskId });
    expect(trace.status).toBe(200);
    expect(trace.data.data.trace_view.nodes.map((node) => node.id)).toEqual(expect.arrayContaining([
      "dsl_root",
      "plan_2",
      "patch_4",
      "review_5",
      "sandbox_6",
    ]));

    const repairContext = await request("POST", "/api/context/build", {
      taskId,
      agentName: "repairAgent",
      currentNodeId: "sandbox_6",
    });

    expect(repairContext.status).toBe(200);
    expect(repairContext.data.data.context).toEqual(expect.objectContaining({
      dependency_summary: expect.any(Object),
      failed_patch_summary: expect.any(Object),
      sandbox_error_summary: expect.any(Object),
      verified_plan_summary: expect.any(Object),
    }));
    expect(repairContext.data.data.source_node_ids).toEqual([
      "sandbox_6",
      "review_5",
      "patch_4",
      "plan_2",
      "dsl_root",
    ]);
  });
});
