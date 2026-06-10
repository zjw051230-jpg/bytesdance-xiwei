# Context Service

`backend/src/ai/context` is an independent event-sourced context service. It stores and projects task context data, builds agent-facing context, applies privacy and redaction safeguards, and evaluates context quality.

This layer is intentionally not an execution engine. It does not run agents, schedule work, execute tools, manage task state, or coordinate human review.

## Responsibilities

Current responsibilities:

- event log
- trace projection
- dependency chain
- summarization
- agent context building
- context budget
- privacy filtering
- redaction overlay
- safe events
- context evaluation
- context benchmark

Current non-responsibilities:

- Runtime
- Orchestrator
- Agent Loop
- hook scheduling
- tool execution
- sandbox execution
- task state machine
- UI / CLI human review

## Module Index

| Module | Purpose | Main exports | Side effects | Writes EventStore |
| --- | --- | --- | --- | --- |
| `eventStore.js` | JSONL append-only event log plus raw and safe reads. | `EventStore`, `appendEvent`, `readEvents`, `readSafeEvents`, `readEventsByType`, `getLatestEventSeq` | File read/write under `.ai-runs/context/tasks` | Yes, only `appendEvent` |
| `traceProjector.js` | Deterministically rebuild `trace_view` from events with redaction overlay. | `TraceProjector`, `rebuildTraceView`, `getTraceView`, `applyEventToTraceView` | Writes cached projection files | No |
| `traceGraphStore.js` | Query trace graph, append trace mutations, and return dependency chains. | `TraceGraphStore`, `appendTraceNode`, `appendTraceEdge`, `getDependencyChain`, `getTraceView` | Uses EventStore for trace mutation append helpers | Yes, through explicit append helpers |
| `compactSummarizer.js` | Build compact dependency summaries without raw logs or full diffs. | `CompactSummarizer`, `buildDependencySummary`, `buildSummaryArtifact` | None beyond injected collaborators | No |
| `agentContextBuilder.js` | Build privacy-filtered and budgeted agent context from trace data. | `AgentContextBuilder`, `buildContextForAgent` | Writes context cache files | No |
| `contextBudgetManager.js` | Enforce context size limits and remove forbidden raw fields. | `ContextBudgetManager`, `fitContextToBudget` | None | No |
| `privacyFilter.js` | Redact sensitive keys and text patterns. | `PrivacyFilter`, `redactSensitiveText`, `redactSensitiveObject`, `detectSensitiveKeys` | None | No |
| `contextEvalRunner.js` | Evaluate context quality, safety, attribution, and replay stability. | `ContextEvalRunner`, `runContextEvalCase`, `runContextEvalSuite`, `calculateContextQualityReport` | None | No |
| `contextBenchmark.js` | Compare baseline context strategies. | `ContextBenchmark`, `benchmarkContextStrategies` | None | No |
| `redactionManifest.js` | Store redaction manifests and apply read-time overlays. | `RedactionManifestStore`, `createRedactionManifest`, `readRedactionManifests`, `applyRedactionOverlay`, `redactValueAtPath` | Writes `redaction_manifests.json`; overlay is in memory | No |

## Optional Repository Context Helpers

`repositoryIndexer.js`, `retriever.js`, and `contextRetrieval.test.js` are optional repository context helpers. They can help locate repository files and snippets, but they are not part of the Event-sourced Trace Memory core chain.

The core Context Service contract remains:

- `EventStore`
- `TraceProjector`
- `TraceGraphStore`
- `CompactSummarizer`
- `AgentContextBuilder`
- `ContextBudgetManager`
- `PrivacyFilter`
- `ContextEvalRunner`
- `ContextBenchmark`
- `RedactionManifest`

If the team later scopes the service to task-trace context only, these repository helpers can be moved out of this directory. This delivery does not move them.

## Main Flow

```text
EventStore
  -> TraceProjector
  -> TraceGraphStore
  -> CompactSummarizer
  -> AgentContextBuilder
  -> ContextBudgetManager
  -> PrivacyFilter
  -> ContextEvalRunner / ContextBenchmark
```

Events are appended to `EventStore`, projected into a `TraceView`, queried through `TraceGraphStore`, summarized through `CompactSummarizer`, assembled into an `AgentContext`, budgeted and filtered, then optionally evaluated or benchmarked.

## HTTP Wrapper

Python or other non-Node callers should use the local Context HTTP Wrapper instead of reading or writing `.ai-runs` directly.

The wrapper is mounted by `backend/src/server.js` and exposes both root paths and `/api/context` aliases:

```text
GET  /context/health
POST /context/build
POST /events/append
GET  /events/latest-seq/:taskId
GET  /events/safe/:taskId
POST /trace/rebuild
```

Equivalent aliases:

```text
GET  /api/context/health
POST /api/context/build
POST /api/context/events/append
GET  /api/context/events/latest-seq/:taskId
GET  /api/context/events/safe/:taskId
POST /api/context/trace/rebuild
```

The wrapper maps the current Python Agent event names into Context Service events, including `PATCH_GENERATED -> PATCH_CREATED` and `EXECUTION_COMPLETED -> SANDBOX_RESULT_RECORDED`.
Within one Node service process, write routes are serialized per `taskId`. This is a local single-writer guard, not a multi-process transactional store.

## Minimal Usage

```js
const {
  eventStore,
  traceProjector,
  agentContextBuilder,
  contextEvalRunner,
} = require("./index");

eventStore.appendEvent("task_001", {
  type: "DSL_FINALIZED",
  payload: {
    dsl_node_id: "dsl_001",
    summary: "Final task DSL",
  },
});

traceProjector.rebuildTraceView("task_001");

const agentContext = agentContextBuilder.buildContextForAgent({
  taskId: "task_001",
  agentName: "repairAgent",
  currentNodeId: "sandbox_001",
});

const evalResult = contextEvalRunner.runContextEvalCase({
  task_id: "task_001",
  target_agent: "repairAgent",
  current_node_id: "sandbox_001",
  context: agentContext,
  expected_source_nodes: ["dsl_001"],
});
```

## Key Boundaries

- `TraceProjector` does not write EventStore.
- `readEvents(taskId)` returns raw events.
- `readSafeEvents(taskId)` returns events after redaction overlay.
- Redaction overlay does not physically modify raw event files.
- `AgentContext` must not contain raw sandbox logs, full patch diffs, full chat history, or unfiltered tool payloads.
- `context_cache` must contain filtered context only.
- `CONTEXT_BUILT` is the current Context Service event emitted by `AgentContextBuilder`.
- `AGENT_CONTEXT_BUILT` is a legacy-compatible projector alias; both payloads must not contain `full_context`.
- Context evaluation and benchmark modules are analysis tools; they do not mutate events.

## Data Safety Rules

- Raw sandbox logs must not enter `AgentContext`.
- `full_patch_diff` must not enter `AgentContext`.
- `full_chat_history` must not enter `AgentContext`.
- Raw events are low-level audit data and should not be used directly as agent input.
- `PrivacyFilter` is the proactive filtering layer before context exposure.
- `RedactionManifest` is the incident recovery layer after sensitive data was mistakenly written.
- Redaction overlay is read-time masking and does not rewrite raw event files.

## Tests

Run all tests with:

```bash
npm test
```

Core Context Service coverage includes:

- EventStore
- TraceProjector
- TraceGraphStore
- CompactSummarizer
- AgentContextBuilder
- ContextBudgetManager
- PrivacyFilter
- ContextEvalRunner
- ContextBenchmark
- RedactionManifest

See `CONTRACTS.md` for stable data contracts, `CONTEXT_SERVICE_DELIVERY.md` for the delivery summary, and `CONTEXT_SERVICE_PERFORMANCE_BASELINE.md` for the local performance baseline scope.
