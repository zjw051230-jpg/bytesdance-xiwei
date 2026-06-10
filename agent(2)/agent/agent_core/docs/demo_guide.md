# End-to-End Demo Guide

This guide shows how to run the current Agent Runtime through the Node/Web backend, open the Web UI, submit an agent task, and inspect the structured result.

## Current Capabilities

The project currently includes:

- Python Agent Runtime with planner, locator, coder, reviewer, executor, and verifier stages.
- Optional Doubao LLM calls for planning, coding, and controlled action selection.
- Memory/context event integration through mock adapters by default, or Context Service HTTP when enabled.
- Real repository file discovery and read-only search.
- Real repository patch dry-run/preview/apply gates.
- Real test preview by default, with optional controlled test execution.
- Node backend endpoint `POST /api/agent/run`.
- Static Web UI with an Agent Run panel.
- JSON task result mode through `AGENT_OUTPUT_JSON=1`.

The runtime remains a prototype. It is suitable for demos, adapter validation, and integration testing.

## Safety Boundaries

Defaults are intentionally safe:

- The Node API sets `AGENT_OUTPUT_JSON=1`.
- The Node API does not set `AGENT_REPO_CONFIRM=YES`.
- The Node API does not set `AGENT_TEST_RUN=1` or `AGENT_TEST_CONFIRM=YES`.
- Real repository mode without confirmation is dry-run or preview only.
- Real test execution is disabled unless both `AGENT_TEST_RUN=1` and `AGENT_TEST_CONFIRM=YES` are set in a trusted local process.
- Dangerous commands, shell chains, redirects, pipes, deletes, downloads, and dependency installs are rejected.
- Python uses hook guards for max steps, loop detection, dangerous edits, unknown tools, and failed tools.

## Start Backend

From `d:\agent`:

```powershell
cd context-service-handoff\context-service-handoff\code\backend
npm install
npm start
```

The backend listens on:

```text
http://127.0.0.1:4000
```

## Open Web UI

Open:

```text
http://127.0.0.1:4000/
```

Use the Agent Run panel:

- `Task`: engineering task text.
- `Repo Path`: optional local repo path.
- `Skill`: optional skill hint.
- `Mode`: `preview` or `dry_run`.
- `Run`: calls `POST /api/agent/run`.

The result panel shows status, task name, steps, selected actions, located files, patch plan, review result, execution result, verification result, risks, stderr, and error.

## Call API Directly

Mock/dry-run request:

```powershell
$body = @{
  task = "文章详情页新增字数统计和阅读时间"
  mode = "dry_run"
} | ConvertTo-Json

Invoke-RestMethod `
  -Uri http://127.0.0.1:4000/api/agent/run `
  -Method Post `
  -ContentType "application/json" `
  -Body $body
```

Real repo preview request:

```powershell
$body = @{
  task = "在 note.txt 中预览写入 hello"
  repoPath = "D:\path\to\repo"
  mode = "preview"
} | ConvertTo-Json

Invoke-RestMethod `
  -Uri http://127.0.0.1:4000/api/agent/run `
  -Method Post `
  -ContentType "application/json" `
  -Body $body
```

API response shape:

```json
{
  "ok": true,
  "result": {
    "task_id": "demo_task",
    "status": "success",
    "task_name": "Add article word count and reading time",
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

## Enable Doubao

Set these before running Python directly or before starting the backend if you want the backend-spawned Python process to inherit them:

```powershell
$env:AGENT_LLM_PROVIDER = "doubao"
$env:DOUBAO_API_KEY = "<your key>"
$env:DOUBAO_ENDPOINT = "<your endpoint/model>"
$env:DOUBAO_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3"
```

Planner/coder gates:

```powershell
$env:AGENT_USE_LLM_PLANNER = "1"
$env:AGENT_USE_LLM_CODER = "1"
```

Smoke test:

```powershell
python -m agent_core.scripts.llm_smoke
```

## Enable LLM Action Decision

Default action selection is fixed and deterministic. To allow controlled LLM action selection:

```powershell
$env:AGENT_LLM_ACTION_DECISION = "1"
```

The LLM can only choose from the runtime whitelist:

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

Invalid JSON, unknown actions, low confidence, or hook guard rejection falls back to the fixed sequence.

## Enable Repo Preview

Direct Python preview:

```powershell
$env:AGENT_REPO_MODE = "real"
$env:AGENT_REPO_ROOT = "D:\path\to\repo"
$env:AGENT_REPO_APPLY = "1"
Remove-Item Env:\AGENT_REPO_CONFIRM -ErrorAction SilentlyContinue
python agent_core\main.py
```

Through Node API, pass:

```json
{
  "task": "preview a safe change",
  "repoPath": "D:\\path\\to\\repo",
  "mode": "preview"
}
```

The Node API does not set `AGENT_REPO_CONFIRM=YES`, so this remains preview-only.

## Enable Controlled Real Tests

Real test execution is only available when running Python in a trusted local process:

```powershell
$env:AGENT_REPO_MODE = "real"
$env:AGENT_REPO_ROOT = "D:\path\to\repo"
$env:AGENT_TEST_RUN = "1"
$env:AGENT_TEST_CONFIRM = "YES"
$env:AGENT_TEST_TIMEOUT = "30"
python agent_core\main.py
```

Allowed execution prefixes include:

```text
python -m unittest
python -c
pytest
npm test
npm run test
```

The Node API intentionally clears `AGENT_TEST_RUN` and `AGENT_TEST_CONFIRM`.

## Demo Tasks

Mock/dry-run task:

```text
文章详情页新增字数统计和阅读时间
```

Suggested request:

```json
{
  "task": "文章详情页新增字数统计和阅读时间",
  "mode": "dry_run"
}
```

Real repo preview task:

```text
创建 note.txt 文件，内容为 hello
```

Suggested request:

```json
{
  "task": "创建 note.txt 文件，内容为 hello",
  "repoPath": "D:\\path\\to\\repo",
  "mode": "preview"
}
```

## One-Command Demo Check

From `d:\agent`:

```powershell
python -m agent_core.scripts.demo_check
```

The script starts the backend on a temporary port, checks `/api/agent/run`, verifies JSON output, and confirms repo preview does not write files without confirmation.
