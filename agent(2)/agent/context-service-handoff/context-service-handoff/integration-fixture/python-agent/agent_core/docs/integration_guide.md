# Integration Guide

## Overview

The runtime is designed around mock-to-real adapter replacement. Runtime orchestration should stay stable while each external boundary moves from a mock implementation to a real service implementation.

## Context Service

Default implementation:

- `MockContextAdapter`
- `MockEventAdapter`
- `MockContextHttpAdapter`

HTTP-backed implementation:

- `ContextServiceAdapter`
- `ContextEventAdapter`
- `RealContextHttpAdapter`

Switch:

```bash
USE_CONTEXT_HTTP=1
CONTEXT_SERVICE_URL=http://127.0.0.1:4000
```

Switch points:

- `agent_core/interfaces/context_adapter.py`
- `agent_core/interfaces/event_adapter.py`
- `agent_core/interfaces/context_http_adapter.py`

Expected HTTP wrapper endpoints are documented in `context_http_contract.md`.

## Repo Service

Default implementation:

- `MockRepoAdapter`
- mock `apply_patch`
- mock `get_diff`
- mock `run_command`

Dry-run real repo implementation:

- `RealRepoAdapter(dry_run=True)` reads real files and records planned patches without modifying files.
- `RealTestAdapter(dry_run=True)` validates whitelisted test commands without executing them.

Switch:

```bash
USE_REAL_REPO=1
REAL_REPO_DRY_RUN=1
USE_REAL_TEST=1
REAL_TEST_DRY_RUN=1
AGENT_REPO_ROOT=/absolute/path/to/repo
```

Real write mode is intentionally not the default. It should only be enabled after patch application has a reviewed diff format and stricter safety checks.

Switch point:

- `agent_core/interfaces/repo_adapter.py`
- `agent_core/interfaces/test_adapter.py`

The executor stage already calls `get_default_repo_adapter()`, so replacing that default with a real adapter is the main integration point.

## LLM Service

Default implementation:

- `MockLLMAdapter`
- deterministic action sequence
- prompt preview only

Ark-backed implementation:

- `RealLLMAdapter` calls an OpenAI-compatible Ark endpoint for action selection.
- The adapter should return the same shape used today:

```json
{
  "thought": "...",
  "tool": "...",
  "args": {}
}
```

Switch:

```bash
USE_REAL_LLM=1
ARK_MODEL=ep-...
ARK_API_KEY=...
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
```

Switch point:

- `agent_core/interfaces/llm_adapter.py`

The model router already provides provider/model metadata through `select_model(state)`.

## Mock to Real Checklist

When replacing a mock adapter:

- Preserve the base adapter method signatures.
- Preserve return shapes consumed by tools and agents.
- Keep existing tests passing.
- Add service-specific tests around failure handling.
- Avoid changing pipeline order unless the runtime contract changes explicitly.
