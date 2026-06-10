const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const contextService = require("../index");
const { EventStore } = require("../eventStore");
const { TraceProjector } = require("../traceProjector");
const { TraceGraphStore } = require("../traceGraphStore");
const { CompactSummarizer } = require("../compactSummarizer");
const { AgentContextBuilder } = require("../agentContextBuilder");
const { ContextEvalRunner } = require("../contextEvalRunner");
const { ContextBenchmark } = require("../contextBenchmark");

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

function createHarness() {
  const storageRoot = tempStorageRoot("context-service-e2e-");
  const now = () => "2026-06-07T00:00:00.000Z";
  let nextEventId = 1;
  let nextContextId = 1;
  let nextSummaryId = 1;

  const eventStore = new EventStore({
    storageRoot,
    now,
    idGenerator: () => `evt_${nextEventId++}`,
  });
  const traceProjector = new TraceProjector({
    eventStore,
    storageRoot,
    now,
    projectorVersion: "context-service-e2e-v1",
  });
  const traceGraphStore = new TraceGraphStore({
    eventStore,
    traceProjector,
    storageRoot,
    now,
  });
  const compactSummarizer = new CompactSummarizer({
    idGenerator: (prefix) => `${prefix}_${nextSummaryId++}`,
  });
  const agentContextBuilder = new AgentContextBuilder({
    eventStore,
    traceProjector,
    traceGraphStore,
    compactSummarizer,
    storageRoot,
    now,
    idGenerator: (prefix) => `${prefix}_${nextContextId++}`,
  });
  const contextEvalRunner = new ContextEvalRunner({ agentContextBuilder });
  const contextBenchmark = new ContextBenchmark({ contextEvalRunner });

  return {
    eventStore,
    traceProjector,
    traceGraphStore,
    compactSummarizer,
    agentContextBuilder,
    contextEvalRunner,
    contextBenchmark,
  };
}

function seedTaskEvents(eventStore, taskId) {
  eventStore.appendEvent(taskId, {
    type: "TASK_CREATED",
    producer: "integrationTest",
    payload: {
      summary: "Article detail word-count repair task",
      requirement: "Show word count on the article detail page.",
    },
  });
  eventStore.appendEvent(taskId, {
    type: "DSL_FINALIZED",
    producer: "dslAgent",
    payload: {
      dsl_node_id: "dsl_001",
      summary: "Article detail page must show word count.",
      metadata: {
        constraints: ["frontend only"],
        note: "Do not expose Bearer abcdefghijklmnop to the agent.",
        full_chat_history: "FULL_CHAT_HISTORY_SHOULD_NOT_APPEAR",
      },
    },
  });
  eventStore.appendEvent(taskId, {
    type: "PLAN_CREATED",
    producer: "planAgent",
    payload: {
      plan_node_id: "plan_001",
      summary: "Read article body, compute word count, and render it in the detail UI.",
      status: "verified",
      depends_on_node_ids: ["dsl_001"],
      metadata: {
        target_files: ["frontend/src/pages/Article.jsx"],
        verification_plan: ["npm test"],
      },
    },
  });
  eventStore.appendEvent(taskId, {
    type: "PATCH_CREATED",
    producer: "codegenAgent",
    payload: {
      patch_node_id: "patch_001",
      summary: "Patch adds wordCount display but leaves a scope bug.",
      status: "failed",
      depends_on_plan_node_id: "plan_001",
      metadata: {
        changed_files: ["frontend/src/pages/Article.jsx"],
        note: "Temporary token sk-integrationsecret123 should be redacted.",
        full_patch_diff: "FULL_PATCH_DIFF_SHOULD_NOT_APPEAR",
      },
    },
  });
  eventStore.appendEvent(taskId, {
    type: "SANDBOX_RESULT_RECORDED",
    producer: "testRunnerAgent",
    payload: {
      sandbox_node_id: "sandbox_001",
      summary: "ReferenceError: wordCount is not defined",
      success: false,
      patch_node_id: "patch_001",
      command: "npm test",
      exit_code: 1,
      error_type: "ReferenceError",
      metadata: {
        likely_cause: "Repair should inspect wordCount scope.",
        note: "Secret text sk-sandboxsecret123 should be redacted.",
        full_sandbox_log: "FULL_SANDBOX_LOG_SHOULD_NOT_APPEAR",
      },
    },
  });
}

function benchmarkContext({ dependencySourceIds }) {
  return {
    source_node_ids: dependencySourceIds,
    budget_report: { after_chars: 600 },
    context: {
      dependency_summary: {
        value: { constraints: ["frontend only"] },
        source_node_ids: dependencySourceIds,
      },
    },
  };
}

describe("Context Service integration", () => {
  test("runs event log, projection, dependency, summary, agent context, eval, and benchmark end to end", () => {
    const taskId = "task_e2e_001";
    const sandboxNodeId = "sandbox_001";
    const {
      eventStore,
      traceProjector,
      traceGraphStore,
      compactSummarizer,
      agentContextBuilder,
      contextEvalRunner,
      contextBenchmark,
    } = createHarness();

    seedTaskEvents(eventStore, taskId);

    const { trace_view: traceView, projection_report: projectionReport } = traceProjector.rebuildTraceView(taskId);
    expect(projectionReport.errors).toEqual([]);

    const dependencyChain = traceGraphStore.getDependencyChain(taskId, sandboxNodeId);
    expect(dependencyChain.chain_nodes.map((node) => node.type)).toEqual([
      "sandbox_result",
      "patch",
      "plan",
      "final_dsl",
    ]);

    const dependencySummary = compactSummarizer.buildDependencySummary({
      taskId,
      targetNodeId: sandboxNodeId,
      traceView,
    });
    const dependencySummaryJson = JSON.stringify(dependencySummary);
    expect(dependencySummary.value.source_node_ids).toEqual([
      "sandbox_001",
      "patch_001",
      "plan_001",
      "dsl_001",
    ]);
    expect(dependencySummaryJson).not.toContain("FULL_SANDBOX_LOG_SHOULD_NOT_APPEAR");
    expect(dependencySummaryJson).not.toContain("FULL_PATCH_DIFF_SHOULD_NOT_APPEAR");

    const agentContext = agentContextBuilder.buildContextForAgent({
      taskId,
      agentName: "repairAgent",
      currentNodeId: sandboxNodeId,
    });
    expect(agentContext.context).toEqual(expect.objectContaining({
      final_dsl_core: expect.any(Object),
      dependency_summary: expect.any(Object),
      failed_patch_summary: expect.any(Object),
      sandbox_error_summary: expect.any(Object),
      verified_plan_summary: expect.any(Object),
      active_interrupts: expect.any(Object),
    }));

    const agentContextJson = JSON.stringify(agentContext);
    expect(agentContextJson).toContain("[REDACTED]");
    expect(agentContextJson).not.toContain("full_context");
    expect(agentContextJson).not.toContain("FULL_CHAT_HISTORY_SHOULD_NOT_APPEAR");
    expect(agentContextJson).not.toContain("FULL_SANDBOX_LOG_SHOULD_NOT_APPEAR");
    expect(agentContextJson).not.toContain("FULL_PATCH_DIFF_SHOULD_NOT_APPEAR");
    expect(agentContextJson).not.toContain("Bearer abcdefghijklmnop");
    expect(agentContextJson).not.toContain("sk-integrationsecret123");
    expect(agentContextJson).not.toContain("sk-sandboxsecret123");

    const evalResult = contextEvalRunner.runContextEvalCase({
      task_id: taskId,
      target_agent: "repairAgent",
      current_node_id: sandboxNodeId,
      context: agentContext,
      expected_source_nodes: ["dsl_001", "plan_001", "patch_001", "sandbox_001"],
      forbidden_source_nodes: ["unrelated_001"],
      expected_attributions: [
        {
          context_path: "context.dependency_summary",
          expected_source_nodes: ["dsl_001", "plan_001", "patch_001", "sandbox_001"],
        },
      ],
    });
    expect(evalResult.passed).toBe(true);
    expect(evalResult.metrics.dependency_recall).toBe(1);
    expect(evalResult.metrics.noise_rate).toBe(0);
    expect(evalResult.metrics.source_attribution_accuracy).toBe(1);
    expect(evalResult.metrics.privacy_leakage).toBe(false);

    const benchmarkResult = contextBenchmark.benchmarkContextStrategies(
      {
        strategies: ["recent_messages", "global_summary", "dependency_chain"],
        expected_source_nodes: ["dsl_001", "plan_001", "patch_001", "sandbox_001"],
        forbidden_source_nodes: ["unrelated_001"],
        expected_constraints: ["frontend only"],
      },
      {
        contextsByStrategy: {
          recent_messages: benchmarkContext({
            dependencySourceIds: ["patch_001", "sandbox_001", "unrelated_001"],
          }),
          global_summary: benchmarkContext({
            dependencySourceIds: ["dsl_001", "plan_001"],
          }),
          dependency_chain: benchmarkContext({
            dependencySourceIds: ["sandbox_001", "patch_001", "plan_001", "dsl_001"],
          }),
        },
        max_chars: 2000,
      },
    );

    expect(benchmarkResult.dependency_chain.quality_report).toEqual(expect.any(Object));
    expect(benchmarkResult.dependency_chain.quality_report.overall_score).toBeGreaterThan(
      benchmarkResult.recent_messages.quality_report.overall_score,
    );
    expect(benchmarkResult.winner).toBe("dependency_chain");
  });

  test("public index exports only Context Service APIs", () => {
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

    const exportedNames = JSON.stringify(Object.keys(contextService));
    const forbiddenExportFragments = [
      "Run" + "time",
      "Ho" + "ok",
      "Diagnostic" + "Event",
      "Access" + "Policy",
    ];
    for (const forbiddenFragment of forbiddenExportFragments) {
      expect(exportedNames).not.toContain(forbiddenFragment);
    }
  });
});
