# Context Service Performance Baseline

This document describes the local performance baseline test for the standalone Context Service. It is not a production load test and does not define hard latency SLOs.

## Covered Scales

The baseline test covers:

- 100 events
- 1000 events
- 5000 events

Each scale uses a temporary `storageRoot` and a unique task id. Test data is removed after each test run.

## Covered Operations

For each scale, the test verifies these operations complete and records `duration_ms` internally:

- `EventStore.appendEvent`
- `TraceProjector.rebuildTraceView`
- `TraceGraphStore.getDependencyChain`
- `AgentContextBuilder.buildContextForAgent`
- `EventStore.readSafeEvents`

## Threshold Policy

The test intentionally does not enforce strict time thresholds. Local machines and CI environments can vary substantially, especially on filesystem-heavy JSONL append/read workloads.

The current purpose is to prove the operations complete across representative local scales and to make the measured operation set explicit. Future production readiness work can add separate stress tests or SLO-oriented benchmarks.

## Non-goals

This baseline does not test:

- concurrent writers
- production storage backends
- networked filesystems
- very large event streams beyond 5000 local JSONL events
- Runtime or Agent execution
