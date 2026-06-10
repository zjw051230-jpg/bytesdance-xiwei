const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventStore } = require("../eventStore");
const { TraceProjector } = require("../traceProjector");
const { TraceGraphStore } = require("../traceGraphStore");
const { AgentContextBuilder } = require("../agentContextBuilder");
const { PrivacyFilter } = require("../privacyFilter");
const { ContextEvalRunner } = require("../contextEvalRunner");
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

function createHarness(prefix = "context-security-") {
  const storageRoot = tempStorageRoot(prefix);
  const now = () => "2026-06-07T00:00:00.000Z";
  let nextEventId = 1;
  let nextContextId = 1;
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

  return { storageRoot, eventStore, traceGraphStore, agentContextBuilder, redactionManifestStore };
}

function seedSensitiveRepairTrace(traceGraphStore, taskId) {
  traceGraphStore.appendTraceNode(taskId, {
    id: "dsl_001",
    type: "final_dsl",
    summary: "Final DSL",
    status: "verified",
    metadata: {
      apiKey: "sk-dslsecret123",
      full_chat_history: "FULL_CHAT_HISTORY_SHOULD_NOT_APPEAR",
    },
  });
  traceGraphStore.appendTraceNode(taskId, {
    id: "plan_001",
    type: "plan",
    summary: "Verified plan",
    status: "verified",
    metadata: { cookie: "sessionid=secret-cookie" },
  });
  traceGraphStore.appendTraceNode(taskId, {
    id: "patch_001",
    type: "patch",
    summary: "Failed patch",
    status: "failed",
    metadata: {
      full_patch_diff: "FULL_PATCH_DIFF_SHOULD_NOT_APPEAR",
      authorization: "Bearer patchtoken123456",
    },
  });
  traceGraphStore.appendTraceNode(taskId, {
    id: "sandbox_001",
    type: "sandbox_result",
    summary: "ReferenceError: wordCount is not defined",
    status: "failed",
    metadata: {
      full_sandbox_log: "FULL_SANDBOX_LOG_SHOULD_NOT_APPEAR",
      secret: "sandbox-secret",
      privateKey: "-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----",
    },
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

describe("Context Service security", () => {
  test("AgentContext and context_cache exclude raw fields and redact sensitive values", () => {
    const taskId = "task_security_agent_context";
    const { storageRoot, eventStore, traceGraphStore, agentContextBuilder } = createHarness();
    seedSensitiveRepairTrace(traceGraphStore, taskId);

    const agentContext = agentContextBuilder.buildContextForAgent({
      taskId,
      agentName: "repairAgent",
      currentNodeId: "sandbox_001",
    });
    const contextBuilt = eventStore.readEventsByType(taskId, "CONTEXT_BUILT")[0];
    const cachedContext = JSON.parse(fs.readFileSync(path.join(storageRoot, contextBuilt.payload.context_cache_ref), "utf8"));
    const serializedAgentContext = JSON.stringify(agentContext);
    const serializedCachedContext = JSON.stringify(cachedContext);

    for (const serialized of [serializedAgentContext, serializedCachedContext]) {
      expect(serialized).not.toContain("full_context");
      expect(serialized).not.toContain("FULL_CHAT_HISTORY_SHOULD_NOT_APPEAR");
      expect(serialized).not.toContain("FULL_SANDBOX_LOG_SHOULD_NOT_APPEAR");
      expect(serialized).not.toContain("FULL_PATCH_DIFF_SHOULD_NOT_APPEAR");
      expect(serialized).not.toContain("sk-dslsecret123");
      expect(serialized).not.toContain("Bearer patchtoken123456");
      expect(serialized).not.toContain("sessionid=secret-cookie");
      expect(serialized).not.toContain("sandbox-secret");
      expect(serialized).not.toContain("BEGIN PRIVATE KEY");
      expect(serialized).toContain("[REDACTED]");
    }
  });

  test("PrivacyFilter redacts sensitive keys and text patterns", () => {
    const filter = new PrivacyFilter();
    const { value, privacy_report: privacyReport } = filter.redactSensitiveObject({
      token: "ghp_abcdefghijklmnopqrstuvwxyz",
      secret: "top-secret",
      apiKey: "sk-abcdefghijklmnopqrstuvwxyz",
      authorization: "Bearer abcdefghijklmnop",
      cookie: "sessionid=abc",
      privateKey: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
      envFile: "SERVICE_TOKEN=supersecret",
      database: "postgres://user:pass@example.com/db",
      nested: {
        note: "Use ghp_zyxwvutsrqponmlkjihgfedcba and sk-zyxwvutsrqponmlk.",
      },
    });
    const serialized = JSON.stringify(value);

    expect(privacyReport.redacted).toBe(true);
    expect(value.token).toBe("[REDACTED]");
    expect(value.secret).toBe("[REDACTED]");
    expect(value.apiKey).toBe("[REDACTED]");
    expect(value.authorization).toBe("[REDACTED]");
    expect(value.cookie).toBe("[REDACTED]");
    expect(value.privateKey).toBe("[REDACTED]");
    expect(serialized).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz");
    expect(serialized).not.toContain("top-secret");
    expect(serialized).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
    expect(serialized).not.toContain("Bearer abcdefghijklmnop");
    expect(serialized).not.toContain("BEGIN PRIVATE KEY");
    expect(serialized).not.toContain("SERVICE_TOKEN=supersecret");
    expect(serialized).not.toContain("postgres://user:pass@example.com/db");
  });

  test("readSafeEvents overlays manifest fields while raw events keep raw semantics", () => {
    const taskId = "task_security_redaction";
    const { eventStore, redactionManifestStore } = createHarness();
    const leakedEvent = eventStore.appendEvent(taskId, {
      type: "DSL_FINALIZED",
      payload: {
        dsl_node_id: "dsl_001",
        summary: "Leaked sk-redactionsecret123",
        metadata: { secret: "ghp_redactionsecret123456" },
      },
    });
    redactionManifestStore.createRedactionManifest(taskId, {
      affected_event_ids: [leakedEvent.event_id],
      redacted_paths: ["payload.summary", "payload.metadata.secret"],
      reason: "secret_leak",
    });

    const rawEvents = eventStore.readEvents(taskId);
    const safeEvents = eventStore.readSafeEvents(taskId);

    expect(rawEvents[0].payload.summary).toContain("sk-redactionsecret123");
    expect(rawEvents[0].payload.metadata.secret).toContain("ghp_redactionsecret123456");
    expect(safeEvents[0].payload.summary).toBe("[REDACTED]");
    expect(safeEvents[0].payload.metadata.secret).toBe("[REDACTED]");
  });

  test("ContextEvalRunner fails a case when privacy leakage is detected", () => {
    const runner = new ContextEvalRunner();

    const result = runner.runContextEvalCase({
      context: {
        source_node_ids: ["dsl_001"],
        context: {
          unsafe: "Bearer abcdefghijklmnop",
        },
      },
      expected_source_nodes: ["dsl_001"],
      forbidden_source_nodes: [],
      expected_constraints: [],
      expected_attributions: [],
    });

    expect(result.metrics.privacy_leakage).toBe(true);
    expect(result.passed).toBe(false);
  });
});
