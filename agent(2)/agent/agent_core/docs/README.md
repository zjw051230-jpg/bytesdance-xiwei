# Agent Runtime + Context Service

For a runnable end-to-end demo through the Node backend and Web UI, see [`demo_guide.md`](demo_guide.md).
For the Agent-side acceptance mapping, see [`agent_acceptance_report.md`](agent_acceptance_report.md).
For Requirement DSL examples, see [`../examples/README.md`](../examples/README.md).

Last synchronized: 2026-06-09.

## Project Overview

This project now has three connected surfaces:

- **Python Agent Runtime**: runs the engineering-task pipeline, stores task state, emits domain events, builds context snapshots, calls Doubao when enabled, searches real repos in preview-safe modes, and can return stable JSON task results.
- **Node Context/API Backend**: exposes Context Service routes and `POST /api/agent/run`, invokes Python with `AGENT_OUTPUT_JSON=1`, captures stdout/stderr/exit code, and returns a structured API response.
- **Static Web UI**: a minimal browser panel for submitting one agent task and rendering the structured result. It is not a full React workbench.

High-level shape:

```text
Static Web UI
  |
  v
Node Backend
  |
  +--> POST /api/agent/run
  |       |
  |       v
  |   Python Agent Runtime
  |
  +--> Context HTTP routes
          |
          v
      Event Store / Trace Builder / Context Builder
```

## Completed Capabilities

| Area | Current status |
| --- | --- |
| Doubao LLM generate | Implemented through `DoubaoLLMAdapter`; gated by provider/API env. |
| LLM action decision | Implemented as optional strict-JSON action selector behind `AGENT_LLM_ACTION_DECISION=1`; default fixed sequence remains unchanged. |
| Memory/Context event | Implemented through in-memory memory events plus optional Context Service event/context adapters. |
| RealRepo read/search/preview | Implemented with repo-root constraints, file tree discovery, task/plan/skill search, and patch preview. |
| RealTest controlled execution | Implemented but disabled by default; requires both `AGENT_TEST_RUN=1` and `AGENT_TEST_CONFIRM=YES`. |
| Agent JSON API | Implemented with `AGENT_OUTPUT_JSON=1`; returns stable machine-readable task results. |
| Conduit repo profile | Implemented; detects Conduit frontend/backend package structure, frameworks, scripts, and key files. |
| PR Draft | Implemented; emits structured submit-for-review output without creating a real PR. |
| Replay | Implemented; supports downstream reruns from whitelisted stages with structured metadata. |
| Historical Recall | Implemented; recalls similar prior cases from memory/events/state with safe structured hints. |
| LLM Metrics | Implemented; records LLM call tokens, latency, provider/model, success/failure, and cost summary. |
| Node `/api/agent/run` | Implemented; calls Python JSON mode and returns `{ ok, result, error, stderr }`. |
| Static Web UI | Implemented as a minimal task submission/result panel served by the Node backend. |
| `demo_check` | Implemented; verifies backend API JSON behavior and safe defaults. |

## Safety Defaults And Limits

The project is intentionally conservative by default:

- Real file writes are not enabled by default. RealRepo writes require explicit apply and confirmation gates.
- Node `/api/agent/run` does not set real write or real test confirmation variables.
- Real tests are preview-only by default. Actual execution requires `AGENT_TEST_RUN=1` and `AGENT_TEST_CONFIRM=YES`.
- Memory is not a persistent vector database. Current memory is in-memory/basic event-context integration, with no semantic embedding index.
- The frontend is a minimal static UI, not a complete React workbench with task history, approvals, trace graph, or multi-user policy.
- Multi-user production policy, durable memory, semantic retrieval, and bounded repair loops remain future work.

## Runtime Flow

```text
input
  |
  v
analyze_requirement
  |
  v
select_skill
  |
  v
make_plan
  |
  v
locate_files
  |
  v
generate_patch
  |
  v
review_patch
  |
  v
execute_patch
  |
  v
verify_result
  |
  v
finish
```

The default action order is still the deterministic fixed sequence. Optional LLM action decision can choose the next action only from this whitelist:

```text
plan_task
locate_files
draft_patch
review_patch
execute_patch
verify_result
summarize_result
stop
```

Invalid JSON, unknown actions, low confidence, unavailable tools, or hook guard rejection falls back to the fixed sequence. Every decision records `decision_source`, selected/rejected action, reason, and confidence in state/events/context/memory.

## LLM Integration

Current adapters:

- `MockLLMAdapter`
- `DoubaoLLMAdapter`

Environment variables:

```text
AGENT_LLM_PROVIDER=doubao
DOUBAO_API_KEY=<key>
DOUBAO_ENDPOINT=<endpoint>
DOUBAO_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
AGENT_USE_LLM_PLANNER=1
AGENT_USE_LLM_CODER=1
AGENT_LLM_ACTION_DECISION=1
```

Planner, coder, and action decision are separately gated so tests and local demos can remain deterministic.

## Repo Adapter

Supported modes:

```text
mock_repo
real_repo_dry_run
real_repo_preview
real_repo_apply
```

Environment variables:

```text
AGENT_REPO_MODE=real
AGENT_REPO_ROOT=<repo path>
AGENT_REPO_APPLY=1
AGENT_REPO_CONFIRM=YES
```

`RealRepoAdapter` supports real file discovery, safe path resolution, candidate file search based on task/plan/skill, structured patch preview, and controlled structured writes. Natural-language patch text is not written directly.

## Test Adapter

`RealTestAdapter` is controlled by a double gate:

```text
AGENT_TEST_RUN=1
AGENT_TEST_CONFIRM=YES
```

Allowed commands include:

```text
python -m unittest discover -s codex-verify -v
pytest
npm test
npm run test
```

Execution uses `shell=False`, repo-limited cwd, timeout, stdout/stderr capture, and exit-code recording. Dangerous commands, chained commands, redirects, pipes, deletes, network downloads, dependency installs, and non-whitelisted commands are rejected.

## Context Service Integration

Python-side adapters:

- `MockContextHttpAdapter` by default.
- `RealContextHttpAdapter` when `USE_CONTEXT_HTTP=1`.
- `ContextServiceAdapter` for context builds.
- `ContextEventAdapter` for event appends and service-side sequence sync.

Environment variables:

```text
USE_CONTEXT_HTTP=1
CONTEXT_SERVICE_URL=http://127.0.0.1:4000
CONTEXT_HTTP_TIMEOUT=5
```

Supported routes:

```text
GET  /context/health
POST /events/append
POST /context/build
POST /trace/rebuild
GET  /events/safe/:taskId
GET  /events/latest-seq/:taskId
```

The same routes are also available through `/api/context`.

## Agent JSON And Node API

Python JSON mode:

```powershell
$env:AGENT_OUTPUT_JSON="1"
python agent_core/main.py
```

Node API:

```text
POST /api/agent/run
```

Request:

```json
{
  "task": "Add a README note",
  "repoPath": "optional repo path",
  "skill": "optional skill hint",
  "mode": "preview"
}
```

Response:

```json
{
  "ok": true,
  "result": {
    "task_id": "demo_task",
    "status": "success",
    "task_name": "Add a README note",
    "steps": 9,
    "selected_actions": [],
    "located_files": {},
    "patch_plan": {},
    "review_result": {},
    "execution_result": {},
    "verification_result": {},
    "summary": {},
    "risks": {},
    "safety_gates": {},
    "events_count": 0
  },
  "error": null,
  "stderr": ""
}
```

## Local Commands

Run Python runtime:

```powershell
python agent_core/main.py
```

Run demo check:

```powershell
python -m agent_core.scripts.demo_check
```

Start backend and Web UI:

```powershell
cd context-service-handoff/context-service-handoff/code/backend
npm start
```

Run Node tests:

```powershell
cd context-service-handoff/context-service-handoff/code/backend
npm test
```

Run Python tests:

```powershell
python -m unittest discover -s codex-verify -v
```

Run a DSL example in JSON mode:

```powershell
$env:AGENT_OUTPUT_JSON="1"
Get-Content agent_core/examples/dsl/l1_article_word_stats.json -Raw | python -m agent_core.main
```

## Current Verification

```text
python -m agent_core.scripts.demo_check
demo_check OK

npm test
Node 9 tests OK

python -m unittest discover -s codex-verify -v
Python 175 tests OK

cd context-service-handoff/context-service-handoff/code/backend
npm test
Node 9 tests OK
```
