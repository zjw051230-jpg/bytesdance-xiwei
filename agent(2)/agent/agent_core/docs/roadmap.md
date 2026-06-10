# Roadmap

Last synchronized: 2026-06-09.

This roadmap separates shipped prototype behavior from remaining production work. Do not treat safe-gated features as enabled-by-default behavior.

## Completed

| Area | Status | Notes |
| --- | --- | --- |
| Agent Runtime | Completed | Python pipeline exists from input to finish with state, artifacts, events, hooks, and safety gates. |
| Planner | Completed | Rule/mock planning plus optional LLM planner gate. |
| Locator | Completed | Uses mock repo data or real repo file discovery/search. |
| Coder | Completed | Generates structured patch plans for supported tasks, with optional LLM coder gate. |
| Reviewer | Completed | Reviews patch plans and blocks unsafe cases. |
| Executor | Completed | Applies through repo adapter modes and preserves dry-run/preview defaults. |
| Verifier | Completed | Produces mock results, real verify preview, or controlled real test observations. |
| Doubao LLM Generate | Completed | `DoubaoLLMAdapter.generate()` is implemented and provider-gated. |
| LLM Action Decision | Completed | Optional strict-JSON action selector behind `AGENT_LLM_ACTION_DECISION=1`; fixed sequence remains default. |
| Memory/Context Events | Completed | Runtime memory events and optional Context Service event/context integration exist. |
| RealRepo Read/Search/Preview | Completed | Real repo tree read, candidate search, and preview-safe patch behavior exist. |
| RealRepo Apply | Completed | Structured writes require explicit apply and confirmation gates. |
| RealTest Controlled Execution | Completed | Whitelisted execution exists behind `AGENT_TEST_RUN=1` and `AGENT_TEST_CONFIRM=YES`. |
| Agent JSON API | Completed | `AGENT_OUTPUT_JSON=1` returns stable task result JSON. |
| Node `/api/agent/run` | Completed | Backend invokes Python JSON mode and returns structured API responses. |
| Static Web UI | Completed | Minimal Agent Run panel submits tasks and renders structured results. |
| Demo Check | Completed | `python -m agent_core.scripts.demo_check` validates API JSON and safe defaults. |
| Context Service HTTP | Completed | Python HTTP adapter and JS Context HTTP wrapper exist. |
| Event Store | Completed | Context Service has event store and safe event reader. |
| Trace Rebuild | Completed | Trace rebuild endpoint and projector exist. |
| Context Builder | Completed | Context build endpoint exists for agent-specific context. |

## Not Completed Or Limited

| Area | Status | Notes |
| --- | --- | --- |
| Default Real Writes | Limited | Real writes are intentionally disabled by default and require confirmation. |
| Persistent Memory | Not Completed | Current memory is in-memory/basic context-event integration. |
| Semantic Retrieval | Not Completed | No semantic/vector retrieval layer yet. |
| Vector Memory | Not Completed | No embedding index exists. |
| Real Test Default | Limited | Real tests are disabled by default and require a double confirmation gate. |
| Frontend Workbench | Limited | Current UI is minimal static HTML/JS, not a full React workbench. |
| Repair Loop | Not Completed | No bounded automatic repair cycle yet. |
| Multi-user Policy | Not Completed | Env gates need per-task policy before production use. |
| Approval Workflow | Not Completed | No production approval queue or audit UI yet. |

## Current Integration State

Agent Runtime and Context Service communicate through an HTTP adapter when enabled:

```text
USE_CONTEXT_HTTP=1
CONTEXT_SERVICE_URL=http://127.0.0.1:4000
```

Supported HTTP operations:

```text
GET  /context/health
POST /events/append
POST /context/build
POST /trace/rebuild
GET  /events/safe/:taskId
GET  /events/latest-seq/:taskId
```

The same operations are also registered under `/api/context`.

The backend and static Web UI can be started from:

```powershell
cd context-service-handoff/context-service-handoff/code/backend
npm start
```

## Next Backend Work

The minimal `POST /api/agent/run` endpoint is complete. Future backend work should focus on production task management:

- task list/detail APIs
- task history persistence
- safe event timeline APIs
- trace view APIs
- per-task policy instead of process env gates
- approval endpoints for patch apply and future verify execution

## Next Frontend Work

The minimal static Agent Run panel is complete. Future UI work:

- full React workbench
- task timeline
- patch preview with approval controls
- trace graph/detail view
- safe events explorer
- task history and status filtering
- final summary and verification views

Frontend should not call Python adapters or Context Service storage directly.

## Next Memory Work

Current memory is not a full long-term memory system. Next work:

- durable memory storage
- semantic retrieval
- vector indexing
- project convention retrieval
- previous fix/failure retrieval
- memory inputs for planner, locator, coder, reviewer, and repair loop

## Next Test Execution Work

Controlled RealTest execution exists. Next work:

- richer per-task command policy
- project-specific test command presets
- flaky-test handling
- failed-test feedback into a bounded repair loop
- test result trend/history storage

## Safety Notes

Current safety controls:

- default mock/fixed modes
- repo root path constraints
- absolute path and parent traversal rejection
- real writes require explicit confirmation
- backend API does not enable real write/test confirmations
- LLM action decision whitelist and fallback
- test command whitelist
- `shell=False` for real test execution
- timeout, stdout/stderr, and exit-code capture

Future safety work:

- per-task policy instead of process env gates
- symlink escape checks
- binary file policy
- max patch size
- secret scanning
- approval audit log

## Current Verification

```text
python -m agent_core.scripts.demo_check
demo_check OK

npm test
Node 9 tests OK

python -m unittest discover -s codex-verify -v
Python 132 tests OK
```
