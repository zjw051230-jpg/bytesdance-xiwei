# Context Service Testing Plan

This document describes the non-invasive test suite for the standalone Context Service. The goal is to prove the service is reasonable, effective, stable, and safe without adding business behavior or changing core implementation files.

## Current Test Layers

| Layer | What it proves |
| --- | --- |
| Unit tests | Individual modules behave correctly: event storage, projection, graph traversal, summarization, context building, budgeting, privacy, redaction, eval, and benchmark. |
| Integration tests | The end-to-end chain works across modules: events -> trace view -> dependency chain -> summary -> AgentContext -> eval -> benchmark. |
| Contract tests | Public API exports and documented contracts stay scoped to Context Service only. |
| Invariant tests | Append-only, deterministic hash, redaction overlay, dependency traversal, and benchmark stability properties hold. |
| Security tests | AgentContext and context cache do not expose raw logs, full diffs, secrets, or token-like values. |
| Failure mode tests | Unsupported events, invalid projection input, empty state, and missing benchmark inputs fail safely. |
| Quality / benchmark tests | Dependency-chain context is measurably better than noisy recent messages and incomplete global summaries in the benchmark fixture. |
| Performance baseline test | Representative local event-stream sizes complete core operations without enforcing brittle timing thresholds. |

## Current Non-goals

The current suite does not add or test:

- Runtime integration
- Agent Loop behavior
- Hook scheduling
- tool execution
- sandbox execution
- task state machine
- external services

## Coverage Check

`package.json` currently defines:

- `test`
- `test:watch`

There is no coverage script in the current project. This task intentionally does not modify `package.json`, install dependencies, or add coverage tooling.

## Suggested Future Enhancements

These are optional and should require explicit team approval before adding dependencies or changing test infrastructure:

- Coverage report with Vitest coverage tooling if the project adopts a coverage script.
- Property-based testing, for example with `fast-check`, for event ordering, graph traversal, and redaction path behavior.
- Mutation testing, for example with StrykerJS, to measure assertion strength.
- Production-grade performance benchmark for larger event streams and trace projection.
- Concurrency stress test for `expectedSeq` and idempotency behavior.

## Data Safety Requirements for Tests

- Use temporary `storageRoot` directories.
- Use unique `taskId` values.
- Clean up temporary directories in `afterEach`.
- Do not write to real `.ai-runs` or `.data` long-term storage.
- Do not depend on external services.
