# Agent Runtime Acceptance Report

Last updated: 2026-06-10

This report maps the Python Agent Runtime capabilities to the course MVP requirements and the Conduit realworld integration goal. The runtime is designed to run in preview-safe mode by default while still exercising the full agent chain on a real target repository shape.

## 1. DSL Input To Agent Execution Chain

The runtime accepts either plain text or Requirement DSL JSON through `python -m agent_core.main`.

When `AGENT_OUTPUT_JSON=1` is set, the runtime returns a machine-readable task result containing:

- requirement metadata
- selected actions
- located files
- patch plan
- review result
- execution result
- verification result
- PR draft
- replay metadata
- historical recall
- LLM metrics
- safety gates

Default action flow:

```text
analyze_requirement
select_skill
make_plan
locate_files
generate_patch
review_patch
execute_patch
verify_result
finish
```

The flow supports deterministic fixed action order by default and optional LLM action selection through a strict whitelist.

## 2. Skill / Agent / Orchestrator Layering

The runtime is separated into clear layers:

- **Requirement DSL**: normalizes task metadata, target repo, acceptance criteria, constraints, and test commands.
- **Skill Registry**: matches requirements to reusable skill definitions and patch strategies.
- **Agents**: planner, locator, coder, reviewer, executor, verifier, PR draft, replay, memory recall, and observability logic.
- **Orchestrator**: owns `AgentState`, action sequencing, hooks, model routing, replay mode, state persistence, and event emission.
- **Adapters**: isolate repo access, tests, memory, events, context service, and LLM providers.

This lets the Agent run the same high-level chain over mock repos, real preview repos, and Conduit-style repos.

## 3. Conduit Real Repo Adaptation

Conduit detection is implemented by the repo profiler. It checks:

- target repo path existence
- `frontend/package.json`
- `backend/package.json`
- React / Vite signals
- Express / Sequelize signals
- frontend/backend key files and scripts

The profile is written to:

```text
state.artifacts["repo_profile"]
```

The JSON result exposes:

- `repo_profile`
- `repo_type`
- `conduit_checks`

If a DSL explicitly targets Conduit but the repo is invalid or not Conduit-like, the task is blocked with a structured reason.

## 4. Module Location

The locator uses plan hints, skill file patterns, user input, historical recall hints, and Conduit repo profile data.

For Conduit:

- L1 frontend requirements prioritize `frontend/src` and frontend package scripts.
- Backend requirements prioritize backend model/router/controller areas.
- L2/fullstack requirements search both frontend and backend surfaces.

Locator output is written to:

```text
state.artifacts["located_files"]
```

## 5. Patch Plan / Review / Execute / Verify

The implementation pipeline is preview-safe:

- `generate_patch` creates a structured patch plan.
- `review_patch` checks risk, dangerous files, acceptance coverage, historical risks, and located-file alignment.
- `execute_patch` routes through repo adapters and defaults to dry-run or preview.
- `verify_result` routes through test adapters and defaults to preview.

Real writes require:

```text
AGENT_REPO_APPLY=1
AGENT_REPO_CONFIRM=YES
```

Real test execution requires:

```text
AGENT_TEST_RUN=1
AGENT_TEST_CONFIRM=YES
```

Node backend integration does not pass confirmation env variables, so API-triggered tasks remain safe by default.

## 6. PR Draft / 提测输出

At `finish`, the runtime generates a structured PR draft:

- title
- summary
- requirement metadata
- matched skill
- changed files
- change plan
- acceptance coverage
- test commands and result
- risk summary
- manual checklist
- rollback plan
- Conduit affected stack and key files when applicable

The draft is written to:

```text
state.artifacts["pr_draft"]
```

It also emits `PR_DRAFT_CREATED` and appears in the JSON API result as `pr_draft`.

If verification failed or the task is blocked, PR draft status is `blocked`; it does not pretend the change is merge-ready.

## 7. Replay / 断点重放

Replay mode supports downstream re-execution from a specific stage:

```json
{
  "mode": "replay",
  "requirement_id": "REQ-...",
  "from_stage": "generate_patch",
  "overrides": {
    "plan": {}
  }
}
```

Allowed stages:

- `select_skill`
- `make_plan`
- `locate_files`
- `generate_patch`
- `review_patch`
- `execute_patch`
- `verify_result`
- `finish`

Replay inherits parent state artifacts, applies overrides, prunes downstream artifacts, and only executes from the requested stage forward. It writes:

- `state.artifacts["replay"]`
- `REPLAY_STARTED`
- `REPLAY_COMPLETED`
- replay memory event
- replayAgent context snapshot

Replay still uses the same hooks and adapter gates, so it cannot bypass safety controls.

## 8. Historical Recall / 业务上下文反哺

After skill selection, the runtime recalls similar historical cases from:

- memory cases/events
- domain events
- previous state artifacts
- Context Service safe events when enabled

Similarity is deterministic and based on:

- requirement type
- skill id
- keyword overlap
- target module overlap
- acceptance criteria overlap

The output includes:

- recalled cases
- similarity score
- matched fields
- reusable plan hints
- reusable file hints
- reusable test commands
- known risks

The recall result is written to `state.artifacts["historical_recall"]` and exposed in JSON. Secret-like content such as `.env`, token, secret, password, or API key values is filtered out. Old patch content is not copied into LLM prompts; only structured hints are used.

## 9. LLM Metrics / 可观测性

Every LLM call records:

- call id
- stage
- provider
- model
- prompt/completion/total token counts
- latency
- success/failure
- error type
- estimated cost
- timestamp

The runtime records calls from:

- LLM action decision
- LLM planner
- LLM coder

If provider usage is missing, token counts are estimated safely from prompt/output lengths. Prompt content is not stored in metrics. The JSON result exposes:

- `llm_metrics`
- `llm_metrics_summary`

The summary includes total calls, success/failure counts, total tokens, total latency, estimated cost, and calls grouped by stage.

## 10. Safety Boundaries

The implemented safety boundaries are:

- no real file writes by default
- no real test execution by default
- Node backend does not pass confirmation env variables
- repo paths are constrained to repo root
- absolute paths and parent traversal are rejected
- dangerous test commands, shell chaining, redirects, deletes, network downloads, and dependency installs are rejected
- replay does not bypass hooks or gates
- historical recall and LLM metrics avoid secret-like content
- no GitHub API calls are made; PR Draft is only an output artifact

## 11. Test Results

Current verification commands:

```powershell
python -m unittest discover -s codex-verify -v
python -m agent_core.scripts.demo_check
cd context-service-handoff\context-service-handoff\code\backend
npm test
```

Latest verification:

```text
Python unittest: 175 tests OK
demo_check: demo_check_ok
Backend npm test: 9 tests OK
```

These tests cover DSL parsing, skill matching, repo profiling, Conduit-specific locator and verifier behavior, PR draft creation, replay, historical recall, LLM metrics, safety gates, adapters, context/event integration, and backend API behavior.
