# Integration Guide

Last synchronized: 2026-06-09.

## Overview

The runtime has moved past a pure mock prototype. It still keeps safe mock/fixed defaults, but the current project includes real Doubao generation, optional LLM action decision, Memory/Context event integration, real repo read/search/preview, controlled RealTest execution, JSON task output, Node `/api/agent/run`, a minimal static Web UI, and `demo_check`.

The integration rule remains: external boundaries are adapters, and real behavior must be explicitly gated.

## Context Service

Current implementations:

- `MockContextAdapter`
- `ContextServiceAdapter`
- `MockEventAdapter`
- `ContextEventAdapter`
- `MockContextHttpAdapter`
- `RealContextHttpAdapter`

Default behavior uses mock/in-memory adapters. Enable live Context Service HTTP with:

```text
USE_CONTEXT_HTTP=1
CONTEXT_SERVICE_URL=http://127.0.0.1:4000
CONTEXT_HTTP_TIMEOUT=5
```

Switch points:

- `agent_core/interfaces/context_adapter.py`
- `agent_core/interfaces/event_adapter.py`
- `agent_core/interfaces/context_http_adapter.py`

Supported routes:

```text
GET  /context/health
POST /events/append
POST /context/build
POST /trace/rebuild
GET  /events/safe/:taskId
GET  /events/latest-seq/:taskId
```

The same routes are available under `/api/context`.

## Repo Integration

Current implementations:

- `MockRepoAdapter`
- `RealRepoAdapter`

RealRepo supports:

- repo-root constrained file reads
- file tree discovery
- task/plan/skill based candidate search
- patch preview
- structured apply only when explicitly confirmed

Modes:

```text
AGENT_REPO_MODE unset
  -> mock_repo

AGENT_REPO_MODE=real + AGENT_REPO_ROOT set
  -> real_repo_dry_run

AGENT_REPO_MODE=real + AGENT_REPO_ROOT set + AGENT_REPO_APPLY=1
  -> real_repo_preview

AGENT_REPO_MODE=real + AGENT_REPO_ROOT set + AGENT_REPO_APPLY=1 + AGENT_REPO_CONFIRM=YES
  -> real_repo_apply
```

Node `/api/agent/run` does not set `AGENT_REPO_CONFIRM=YES`, so backend-triggered repo work stays dry-run or preview.

## LLM Integration

Current implementations:

- `MockLLMAdapter`
- `DoubaoLLMAdapter`

Doubao generate is enabled through:

```text
AGENT_LLM_PROVIDER=doubao
DOUBAO_API_KEY=<key>
DOUBAO_ENDPOINT=<endpoint>
DOUBAO_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
```

Planner and coder LLM use are independently gated:

```text
AGENT_USE_LLM_PLANNER=1
AGENT_USE_LLM_CODER=1
```

Optional action decision is enabled with:

```text
AGENT_LLM_ACTION_DECISION=1
```

The selector must return strict JSON with an action from the runtime whitelist. Illegal output, low confidence, unknown action, unavailable tool, or hook guard rejection falls back to the fixed action sequence.

## Test Integration

Current implementations:

- `MockTestAdapter`
- `RealTestAdapter`

RealTest preview is available without executing commands. Actual test execution requires both:

```text
AGENT_TEST_RUN=1
AGENT_TEST_CONFIRM=YES
```

Execution policy:

- whitelist-only commands
- `shell=False`
- repo-root constrained cwd
- timeout
- stdout/stderr capture
- exit-code recording
- structured observations for failures and timeouts

Node `/api/agent/run` clears real test execution/confirmation variables, so API-driven verification remains preview-only.

## Agent JSON And Node API

Python JSON mode:

```text
AGENT_OUTPUT_JSON=1
```

Node API:

```text
POST /api/agent/run
```

Request body:

```json
{
  "task": "engineering task",
  "repoPath": "optional repo path",
  "skill": "optional skill hint",
  "mode": "preview"
}
```

Response body:

```json
{
  "ok": true,
  "result": {},
  "error": null,
  "stderr": ""
}
```

The Node backend captures Python stdout/stderr/exit code, parses stdout JSON, and returns structured errors for Python failure, invalid JSON, and timeout.

## Static Web UI

The current Web UI is served by the Node backend and provides a minimal Agent Run panel:

- task input
- optional repo path
- optional skill
- preview/dry-run mode selector
- structured result rendering

It does not provide a production React workbench, task history, approval queues, or trace graph.

## Mock To Real Checklist

When extending an adapter:

- Preserve base adapter method signatures.
- Preserve return shapes consumed by tools and agents.
- Keep mock/fixed defaults intact.
- Keep existing safety gates intact.
- Add tests around success, fallback, and failure handling.
- Avoid changing pipeline order unless the runtime contract changes explicitly.

## Verified Results

```text
python -m agent_core.scripts.demo_check
demo_check OK

npm test
Node 9 tests OK

python -m unittest discover -s codex-verify -v
Python 132 tests OK
```
