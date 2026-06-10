# Agent Runtime Core

## Project Overview

`agent_core` is a Python Agent Runtime Core prototype. It models an engineering task as a deterministic agent pipeline with clear state, artifacts, hooks, adapters, mock execution, verification, and delivery summary.

The project is intentionally adapter-first. Current integrations are mock implementations, while the runtime contracts are shaped so real LLM, repo, test, memory, and Context Service implementations can replace them later.

## Runtime Core Positioning

The Runtime Core owns:

- task state lifecycle
- pipeline orchestration
- action selection
- hook-based safety checks
- artifact passing between stages
- context snapshot recording
- domain event recording
- final summary generation

It does not currently own real code modification, real shell execution, real npm tests, real LLM calls, or a real Context Service connection.

## Current Capabilities

- Runs a complete mock agent workflow from requirement analysis to final summary.
- Selects skills from local JSON skill definitions.
- Creates structured plans for known skill scenarios.
- Locates target file candidates from plan hints.
- Generates mock patch plans.
- Reviews patch plans for risk and dangerous targets.
- Executes patch plans through a mock repo adapter.
- Verifies execution through a mock test adapter.
- Builds mock Context Service snapshots.
- Appends mock domain events.
- Saves task state to `agent_core/storage/states`.
- Provides a demo CLI through `python agent_core/main.py`.

## Agent Pipeline

The current pipeline is:

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

## Adapter Layer

The runtime uses adapters for external boundaries:

- `BaseLLMAdapter`
- `BaseMemoryAdapter`
- `BaseRepoAdapter`
- `BaseContextAdapter`
- `BaseEventAdapter`
- `BaseContextHttpAdapter`
- `BaseTestAdapter`

Current defaults are mock or in-memory implementations.

## Run

From the repository root:

```bash
python agent_core/main.py
```

Pipe input for a quick demo:

```bash
echo 文章详情页新增字数统计 | python agent_core/main.py
```

## Test

```bash
python -m unittest discover -s codex-verify -v
```

Current status: 39 tests passing.

## Current Completion

Completed:

- Runtime state and loop
- Planner, locator, coder, reviewer, executor, verifier stages
- Hook guards
- Mock LLM, repo, memory, test, context, event adapters
- Context HTTP adapter abstraction
- CLI summary output
- Context HTTP contract documentation

## Roadmap

Next likely work:

- Real LLM adapter
- Real repo adapter
- Real Context Service HTTP wrapper
- Real HTTP-backed context/event adapter
- Persistent memory store
- Real command/test execution under controlled sandbox policy
- Richer skill registry and plan generation
