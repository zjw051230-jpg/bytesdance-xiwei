# Context Service Delivery Summary

## 1. Module Positioning

`backend/src/ai/context` is now a standalone Context Service. It provides event-sourced context storage, trace projection, dependency-aware context construction, privacy filtering, redaction overlay, evaluation, and benchmark tooling.

It does not own or implement:

- Runtime
- Agent Loop
- Orchestrator
- Tool scheduling
- Sandbox execution
- task state machine
- UI / CLI human review

## 2. Problems Solved

The service answers these core context-management questions:

- How agent execution history is persisted: append-only task events in `EventStore`.
- How context is built by dependency chain: projected trace graph plus `depends_on` traversal.
- How old logs, patches, and sandbox results are compacted: rule-based summaries that exclude raw logs and full diffs.
- How different agents receive different context: `AgentContextBuilder` builds role-specific context for plan/codegen/repair/delivery agents.
- How sensitive data is filtered: `PrivacyFilter` redacts sensitive keys and token-like text before agent exposure.
- How accidental secret writes are mitigated: `RedactionManifest` and redaction overlay produce safe event reads without rewriting raw events.
- How context quality is evaluated: `ContextEvalRunner` measures recall, noise, constraints, attribution, privacy leakage, and replay stability.
- How dependency-chain context compares to baselines: `ContextBenchmark` compares `dependency_chain`, `recent_messages`, and `global_summary`.

## 3. Core Flow

```text
appendEvent
  -> rebuildTraceView
  -> getDependencyChain
  -> buildDependencySummary
  -> buildContextForAgent
  -> PrivacyFilter
  -> runContextEvalCase
  -> benchmarkContextStrategies
```

This flow is covered by the end-to-end integration test.

## 4. Current Modules Kept

| Module | Role |
| --- | --- |
| `eventStore.js` | Append-only JSONL event store, raw reads, safe reads, idempotency, and optimistic concurrency checks. |
| `traceProjector.js` | Rebuilds deterministic `trace_view` and projection report from events. |
| `traceGraphStore.js` | Provides trace graph access, trace mutation helpers, and dependency-chain traversal. |
| `compactSummarizer.js` | Produces compact summaries for plans, patches, sandbox results, repairs, and dependency chains. |
| `agentContextBuilder.js` | Builds filtered, budgeted, agent-specific context and context cache metadata. |
| `contextBudgetManager.js` | Enforces context budget and removes forbidden raw fields. |
| `privacyFilter.js` | Redacts sensitive keys and text patterns. |
| `contextEvalRunner.js` | Evaluates context quality and safety metrics. |
| `contextBenchmark.js` | Compares supported context strategies. |
| `redactionManifest.js` | Stores redaction manifests and applies read-time redaction overlay. |
| `index.js` | Public API aggregation entrypoint for the Context Service. |

Optional repository context helpers:

- `repositoryIndexer.js`: builds a lightweight repository file index.
- `retriever.js`: retrieves repository snippets from an index.
- `contextRetrieval.test.js`: covers the optional helper behavior.

These helpers are adjacent to the Context Service but are not part of the Event-sourced Trace Memory core chain.

## 5. Public API

`index.js` exports only Context Service modules:

- `eventStore`
- `traceProjector`
- `traceGraphStore`
- `compactSummarizer`
- `agentContextBuilder`
- `contextBudgetManager`
- `privacyFilter`
- `contextEvalRunner`
- `contextBenchmark`
- `redactionManifest`

It does not export Runtime, Hook, diagnostic event, AccessPolicy, or deleted modules.

## 6. Minimal Usage

```js
const {
  eventStore,
  traceProjector,
  agentContextBuilder,
  contextEvalRunner,
} = require("./index");

eventStore.appendEvent("task_001", {
  type: "TASK_CREATED",
  payload: { requirement: "Show word count on article detail page." },
});

eventStore.appendEvent("task_001", {
  type: "DSL_FINALIZED",
  payload: {
    dsl_node_id: "dsl_001",
    summary: "Article detail page must show word count.",
  },
});

eventStore.appendEvent("task_001", {
  type: "PLAN_CREATED",
  payload: {
    plan_node_id: "plan_001",
    summary: "Compute and render word count.",
    depends_on_node_ids: ["dsl_001"],
  },
});

eventStore.appendEvent("task_001", {
  type: "PATCH_CREATED",
  payload: {
    patch_node_id: "patch_001",
    summary: "Patch adds word count display.",
    depends_on_plan_node_id: "plan_001",
  },
});

eventStore.appendEvent("task_001", {
  type: "SANDBOX_RESULT_RECORDED",
  payload: {
    sandbox_node_id: "sandbox_001",
    summary: "ReferenceError: wordCount is not defined",
    success: false,
    patch_node_id: "patch_001",
  },
});

traceProjector.rebuildTraceView("task_001");

const repairContext = agentContextBuilder.buildContextForAgent({
  taskId: "task_001",
  agentName: "repairAgent",
  currentNodeId: "sandbox_001",
});

const evalResult = contextEvalRunner.runContextEvalCase({
  task_id: "task_001",
  target_agent: "repairAgent",
  current_node_id: "sandbox_001",
  context: repairContext,
  expected_source_nodes: ["dsl_001", "plan_001", "patch_001", "sandbox_001"],
});

const safeEvents = eventStore.readSafeEvents("task_001");
```

## 7. Test Status

Run:

```bash
npm test
```

Current result:

- `31` test files passed
- `198` tests passed

Coverage includes:

- unit tests
- contract, invariant, security, failure mode, and quality tests
- redaction tests
- privacy tests
- benchmark tests
- end-to-end integration test
- local performance baseline test

## 8. Explicit Boundaries

The current Context Service does not provide:

- Runtime
- Agent Loop
- Orchestrator
- Hook scheduling
- Tool execution
- Sandbox execution
- task state machine
- human-review UI
- full RBAC
- vector database
- LLM summarizer

## 9. Remaining Risks Before Real Integration

- External systems must define who calls each Context Service API and when.
- Callers must consistently use `appendEvent` `expectedSeq` for concurrent write paths.
- Raw event audit permissions need a separate access design.
- `context_cache` retention and cleanup policy needs separate design.
- Agent, Tool, and Sandbox layers must consume only filtered context.
- The team should confirm whether `repositoryIndexer.js` and `retriever.js` are part of the final Context Service boundary or adjacent repository-context helpers.
- The performance baseline is a local completion baseline, not a production stress test.

## 10. Delivery Judgment

The current Context Service is ready to be delivered as an independent module.

It can prove the core chain without depending on a Runtime main loop:

```text
events -> trace_view -> dependency_chain -> dependency_summary -> AgentContext -> eval -> benchmark
```

The module is scoped, tested, and no longer carries Runtime, Hook, diagnostic-event, simulation, or AccessPolicy implementation as part of the current delivery.
