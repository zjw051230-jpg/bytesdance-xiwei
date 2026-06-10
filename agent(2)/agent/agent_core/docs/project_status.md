# Project Status

Last verified: 2026-06-09.

## Current Reality

This project is no longer a pure mock-only runtime. It is a safe-by-default Agent Runtime prototype with real integration paths behind explicit gates:

- Python Agent Runtime runs the full engineering pipeline.
- Doubao LLM `generate()` integration exists.
- Controlled LLM action decision exists behind `AGENT_LLM_ACTION_DECISION=1`.
- Memory/context domain events are recorded locally by default and can be sent through Context Service HTTP.
- RealRepo can read/search real repository files and produce dry-run/preview/apply results.
- RealTest can preview by default and execute tests only with explicit double confirmation.
- `AGENT_OUTPUT_JSON=1` emits machine-readable task results.
- Node backend exposes `POST /api/agent/run`.
- Static Web UI exposes an Agent Run panel.
- `python -m agent_core.scripts.demo_check` verifies an end-to-end demo path.

## Completed Capabilities

| Area | Status | Notes |
| --- | --- | --- |
| Runtime Core | Completed | Deterministic pipeline remains the default safe behavior. |
| Planner / Locator / Coder / Reviewer / Executor / Verifier | Completed | Pipeline stages exist and are covered by tests. |
| Doubao LLM generate | Completed | `DoubaoLLMAdapter.generate()` calls the configured provider through the OpenAI-compatible client. |
| LLM planner/coder gates | Completed | `AGENT_USE_LLM_PLANNER=1` and `AGENT_USE_LLM_CODER=1`. |
| LLM action decision | Completed | `AGENT_LLM_ACTION_DECISION=1`, strict JSON whitelist, fallback on invalid output or hook rejection. |
| Memory/context events | Completed | Runtime records action/domain/test events; Context HTTP path is available with `USE_CONTEXT_HTTP=1`. |
| RealRepo read/search | Completed | Lists code files, reads file content, searches paths/content, rejects path escapes. |
| RealRepo dry-run/preview | Completed | Default real repo mode is non-writing; preview requires apply gate but not confirmation. |
| RealRepo apply | Completed with gate | Structured writes require `AGENT_REPO_APPLY=1` and `AGENT_REPO_CONFIRM=YES`. |
| RealTest preview | Completed | Default real test behavior is preview only. |
| RealTest controlled execution | Completed with gate | Requires `AGENT_TEST_RUN=1` and `AGENT_TEST_CONFIRM=YES`, uses `shell=False`, cwd, timeout, stdout/stderr capture. |
| Agent JSON output | Completed | `AGENT_OUTPUT_JSON=1` returns stable task result JSON. |
| Node agent API | Completed | `POST /api/agent/run` calls Python and returns `{ ok, result, error, stderr }`. |
| Static Web UI | Completed | Minimal Agent Run panel under backend static `public/`. |
| Context Service wrapper | Completed | Context health, event append, safe events, context build, trace rebuild endpoints exist. |
| Demo check | Completed | Starts backend, checks API JSON, confirms repo preview does not write. |

## Still Not Completed / Limits

| Area | Status | Notes |
| --- | --- | --- |
| Production autonomous agent | Limited | Default action order is still deterministic; LLM action decision is gated and controlled. |
| Default real file writes | Intentionally disabled | Real writes never happen by default and require explicit confirmation. |
| Persistent vector memory | Not completed | Current memory is in-memory/basic event/context integration, not a durable semantic/vector store. |
| Real tests by default | Intentionally disabled | Real test execution is off unless both execution gates are set. |
| Full frontend workbench | Not completed | Current UI is a minimal static Agent Run panel, not a complete React application. |
| Multi-user task policy | Not completed | Most gates are still environment-variable based; production needs per-task policy and approvals. |
| Repair loop | Not completed | No bounded automatic repair loop from failed tests back into coding. |

## Safety Defaults

By default:

- No real repository writes.
- No real shell/test execution.
- Node `/api/agent/run` clears `AGENT_REPO_CONFIRM`, `AGENT_TEST_RUN`, and `AGENT_TEST_CONFIRM`.
- RealRepo rejects absolute paths, parent traversal, and unsupported operations.
- RealTest rejects shell chains, redirects, pipes, deletes, downloads, dependency installs, and non-whitelisted commands.
- Hook guards remain active for max steps, unknown tools, loops, dangerous edits, and tool failures.

## Test Status

Current verified results:

```text
python -m agent_core.scripts.demo_check
demo_check OK

npm test
Node 9 tests OK

python -m unittest discover -s codex-verify -v
Python 132 tests OK
```

## Delivery Readiness

Ready for:

- End-to-end local demo through Web UI and Node API.
- Adapter contract review.
- Safe repo read/search/preview experiments.
- Controlled real test execution experiments in trusted local environments.
- Context Service integration smoke tests.

Not ready for:

- Unattended production code modification.
- Multi-user production approval workflows.
- Durable semantic memory use cases.
- Full UI-driven patch approval and repair-loop orchestration.
