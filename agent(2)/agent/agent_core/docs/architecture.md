# Architecture

Last synchronized: 2026-06-09.

## Module Boundary

The project is split into three active surfaces:

- Python **Agent Runtime**
- JavaScript **Context Service / Agent API Backend**
- Minimal static **Web UI**

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

The Web UI is intentionally minimal: it submits one task to the backend and renders the structured result. It is not a full React workbench.

## Agent Runtime Flow

```text
main.py or Node /api/agent/run
  |
  v
run_agent(user_input)
  |
  v
AgentState + Memory.retrieve()
  |
  v
ModelRouter + action decision
  |
  +--> default fixed sequence
  +--> optional LLM action selector
  |
  v
HookRunner pre-hooks
  |
  v
Tool Registry
  |
  +--> analyze_requirement
  +--> select_skill
  +--> make_plan
  +--> locate_files
  +--> generate_patch
  +--> review_patch
  +--> execute_patch
  +--> verify_result
  +--> finish
  |
  v
HookRunner post-hooks
  |
  v
State JSON + Context Snapshots + Domain Events + Optional JSON stdout
```

The runtime is adapter-first. External behavior is behind interfaces so mock, preview, apply, HTTP, and controlled execution implementations can be swapped without rewriting the loop.

## Action Decision

Default behavior is a deterministic fixed sequence. This keeps local development and tests stable.

Optional LLM action decision is enabled with:

```text
AGENT_LLM_ACTION_DECISION=1
```

The LLM must return strict JSON and can only choose from:

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

Invalid JSON, unknown actions, low confidence, unavailable tools, or hook guard rejection falls back to the fixed sequence. Every decision is recorded in state, memory event, context snapshot, and `ACTION_DECIDED` event.

## LLM Adapters

```text
Planner / Coder / Action Selector
  |
  v
LLM Adapter
  |
  +--> MockLLMAdapter
  |
  +--> DoubaoLLMAdapter
```

Relevant environment variables:

```text
AGENT_LLM_PROVIDER=doubao
DOUBAO_API_KEY=<key>
DOUBAO_ENDPOINT=<endpoint>
DOUBAO_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
AGENT_USE_LLM_PLANNER=1
AGENT_USE_LLM_CODER=1
AGENT_LLM_ACTION_DECISION=1
```

Doubao `generate()` is implemented. Planner, coder, and action selector are gated independently.

## Repo Adapter Chain

```text
generate_patch
  |
  v
patch_plan
  |
  v
review_patch
  |
  v
execute_patch
  |
  v
RepoAdapter.apply_patch()
  |
  +-- MockRepoAdapter ------------------> mock_repo
  |
  +-- RealRepoAdapter, no apply --------> real_repo_dry_run
  |
  +-- RealRepoAdapter, apply no confirm -> real_repo_preview
  |
  +-- RealRepoAdapter, apply confirmed -> real_repo_apply
```

RealRepo also supports safe read/list/search:

- real file tree discovery
- path and content search
- safe repo-root resolution
- absolute path and parent traversal rejection

Real writes require:

```text
AGENT_REPO_MODE=real
AGENT_REPO_ROOT=<repo path>
AGENT_REPO_APPLY=1
AGENT_REPO_CONFIRM=YES
```

Node `/api/agent/run` never sets `AGENT_REPO_CONFIRM=YES`, so backend-driven repo work remains dry-run or preview.

## Test Adapter Chain

```text
verify_result
  |
  v
Verifier Agent
  |
  v
TestAdapter.run_tests(commands)
  |
  +-- MockTestAdapter --> mock_test, passed=True
  |
  +-- RealTestAdapter --> preview by default
  |
  +-- RealTestAdapter --> controlled execution with double confirmation
```

RealTest execution requires:

```text
AGENT_TEST_RUN=1
AGENT_TEST_CONFIRM=YES
```

Execution uses `shell=False`, repo-limited cwd, timeout, stdout/stderr capture, and exit-code recording. Dangerous commands, shell chains, redirects, pipes, deletes, downloads, dependency installs, and non-whitelisted commands are rejected.

Node `/api/agent/run` clears `AGENT_TEST_RUN` and `AGENT_TEST_CONFIRM`, so backend-driven test work remains preview-only.

## Context And Events

Before key stages, the runtime builds context snapshots:

```text
action decision -> actionSelector
make_plan       -> planAgent
locate_files    -> locatorAgent
generate_patch  -> codegenAgent
review_patch    -> deliveryAgent
execute_patch   -> repairAgent
verify_result   -> deliveryAgent
test execution  -> verifierAgent
```

After key tools complete, the runtime appends events:

```text
ACTION_DECIDED
PLAN_CREATED
FILES_LOCATED
PATCH_GENERATED
REVIEW_COMPLETED
EXECUTION_COMPLETED
VERIFICATION_COMPLETED
TEST_EXECUTED
TASK_FINISHED
```

Default behavior uses mock/in-memory adapters. With `USE_CONTEXT_HTTP=1`, append/build go through the Context Service.

## Context Service Communication

The Agent Runtime does not read Context Service storage files directly.

```text
Agent Runtime
  |
  v
ContextAdapter / EventAdapter
  |
  v
ContextHttpAdapter
  |
  v HTTP JSON
Context Service
```

Default behavior:

```text
USE_CONTEXT_HTTP unset -> MockContextHttpAdapter
USE_CONTEXT_HTTP=1    -> RealContextHttpAdapter
```

Supported endpoints:

```text
GET  /context/health
POST /events/append
POST /context/build
POST /trace/rebuild
GET  /events/safe/:taskId
GET  /events/latest-seq/:taskId
```

The same routes are available under `/api/context`.

## Agent JSON API

Python JSON output:

```text
AGENT_OUTPUT_JSON=1
python agent_core/main.py
```

Node API:

```text
POST /api/agent/run
```

Request:

```json
{
  "task": "engineering task",
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
    "task_name": "...",
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

## Memory Status

Current memory path:

```text
run_agent start -> memory.retrieve(user_input)
runtime events   -> memory.save_event(...)
finish           -> memory.save_case(...)
finish           -> memory.save_event(...)
```

Current implementation includes `InMemoryMemoryAdapter` and Context HTTP event/context integration. Persistent memory, semantic retrieval, vector indexing, and durable cross-session memory are not implemented.

## State And Artifacts

State is persisted under:

```text
agent_core/storage/states/<task_id>.json
```

Important artifacts:

```text
memory_hit_count
action_decisions
latest_agent_context
plan
located_files
patch_plan
review
execution_result
preview_result
verification_result
verify_preview
final_summary
last_event
last_test_event
```

## Verification Status

Current verified results:

```text
python -m agent_core.scripts.demo_check
demo_check OK

npm test
Node 9 tests OK

python -m unittest discover -s codex-verify -v
Python 132 tests OK
```
