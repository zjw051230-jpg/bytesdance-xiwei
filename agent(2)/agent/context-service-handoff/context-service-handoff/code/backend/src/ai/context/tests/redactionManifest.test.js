const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  RedactionManifestStore,
  REDACTED_VALUE,
  applyRedactionOverlay,
  redactValueAtPath,
} = require("../redactionManifest");

function createStore() {
  return new RedactionManifestStore({
    storageRoot: fs.mkdtempSync(path.join(os.tmpdir(), "redaction-manifest-")),
    now: () => "2026-06-07T12:00:00.000Z",
    idGenerator: (() => {
      let nextId = 1;
      return () => `redact_${nextId++}`;
    })(),
  });
}

function createEvents() {
  return [
    {
      event_id: "evt_001",
      type: "DSL_FINALIZED",
      payload: {
        summary: "safe",
        secret: "sk-secret-value",
        tool_result: { env: { OPENAI_API_KEY: "sk-env-secret" } },
      },
    },
    {
      event_id: "evt_002",
      type: "PLAN_CREATED",
      payload: { summary: "plan", secret: "not-targeted" },
    },
  ];
}

describe("RedactionManifestStore", () => {
  test("createRedactionManifest saves a manifest", () => {
    const store = createStore();

    const manifest = store.createRedactionManifest("task_001", {
      affected_event_ids: ["evt_001"],
      redacted_paths: ["payload.secret"],
      reason: "secret_leak",
    });

    expect(manifest).toMatchObject({
      manifest_id: "redact_1",
      task_id: "task_001",
      affected_event_ids: ["evt_001"],
      redacted_paths: ["payload.secret"],
      reason: "secret_leak",
      created_at: "2026-06-07T12:00:00.000Z",
    });
  });

  test("readRedactionManifests reads saved manifests in stable order", () => {
    const store = createStore();
    store.createRedactionManifest("task_001", {
      manifest_id: "redact_b",
      affected_event_ids: ["evt_002"],
      redacted_paths: ["payload.secret"],
      reason: "policy",
      created_at: "2026-06-07T12:00:01.000Z",
    });
    store.createRedactionManifest("task_001", {
      manifest_id: "redact_a",
      affected_event_ids: ["evt_001"],
      redacted_paths: ["payload.secret"],
      reason: "secret_leak",
      created_at: "2026-06-07T12:00:00.000Z",
    });

    expect(store.readRedactionManifests("task_001").map((manifest) => manifest.manifest_id)).toEqual([
      "redact_a",
      "redact_b",
    ]);
  });

  test("rejects unsupported redaction reasons", () => {
    const store = createStore();

    expect(() => store.createRedactionManifest("task_001", {
      affected_event_ids: ["evt_001"],
      redacted_paths: ["payload.secret"],
      reason: "unknown",
    })).toThrow(/Unsupported redaction reason/);
  });
});

describe("redaction overlay", () => {
  test("redactValueAtPath redacts nested dot paths", () => {
    const event = createEvents()[0];

    redactValueAtPath(event, "payload.tool_result.env.OPENAI_API_KEY");

    expect(event.payload.tool_result.env.OPENAI_API_KEY).toBe(REDACTED_VALUE);
  });

  test("applyRedactionOverlay redacts only affected events and paths", () => {
    const safeEvents = applyRedactionOverlay(createEvents(), [
      {
        manifest_id: "redact_001",
        affected_event_ids: ["evt_001"],
        redacted_paths: ["payload.secret", "payload.tool_result.env.OPENAI_API_KEY"],
      },
    ]);

    expect(safeEvents[0].payload.secret).toBe(REDACTED_VALUE);
    expect(safeEvents[0].payload.tool_result.env.OPENAI_API_KEY).toBe(REDACTED_VALUE);
    expect(safeEvents[1].payload.secret).toBe("not-targeted");
  });

  test("applyRedactionOverlay does not mutate original events", () => {
    const events = createEvents();

    applyRedactionOverlay(events, [
      { manifest_id: "redact_001", affected_event_ids: ["evt_001"], redacted_paths: ["payload.secret"] },
    ]);

    expect(events[0].payload.secret).toBe("sk-secret-value");
  });

  test("missing redacted paths are skipped safely", () => {
    const events = createEvents();

    expect(() => applyRedactionOverlay(events, [
      { manifest_id: "redact_001", affected_event_ids: ["evt_001"], redacted_paths: ["payload.missing.deep"] },
    ])).not.toThrow();
  });

  test("same input produces stable overlay output", () => {
    const events = createEvents();
    const manifests = [
      { manifest_id: "redact_001", affected_event_ids: ["evt_001"], redacted_paths: ["payload.secret"] },
    ];

    expect(applyRedactionOverlay(events, manifests)).toEqual(applyRedactionOverlay(events, manifests));
  });

  test("multiple manifests can apply together", () => {
    const safeEvents = applyRedactionOverlay(createEvents(), [
      { manifest_id: "redact_001", affected_event_ids: ["evt_001"], redacted_paths: ["payload.secret"] },
      { manifest_id: "redact_002", affected_event_ids: ["evt_002"], redacted_paths: ["payload.secret"] },
    ]);

    expect(safeEvents[0].payload.secret).toBe(REDACTED_VALUE);
    expect(safeEvents[1].payload.secret).toBe(REDACTED_VALUE);
  });

  test("safe events no longer contain the redacted secret", () => {
    const safeEvents = applyRedactionOverlay(createEvents(), [
      { manifest_id: "redact_001", affected_event_ids: ["evt_001"], redacted_paths: ["payload.secret"] },
    ]);

    expect(JSON.stringify(safeEvents)).not.toContain("sk-secret-value");
  });
});
