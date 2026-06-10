# Context HTTP Adapter Contract

## Background

The Python Agent Runtime cannot call the Node.js/CommonJS Context Service in the same process. The integration boundary is a local HTTP wrapper owned by the Context Service side.

The Python runtime will call this wrapper through a context HTTP adapter. The current implementation uses `MockContextHttpAdapter` and does not send network requests. A future `RealContextHttpAdapter` should implement the same contract.

## Required Endpoints

### POST /context/build

Builds the context package for a specific agent stage.

Request:

```json
{
  "taskId": "task_001",
  "agentName": "planAgent",
  "currentNodeId": "plan_001"
}
```

Response:

```json
{
  "ok": true,
  "data": {
    "task_id": "task_001",
    "agent_name": "planAgent",
    "current_node_id": "plan_001",
    "context": {},
    "source_node_ids": [],
    "source_event_ids": [],
    "budget_report": {},
    "privacy_report": {},
    "created_at": "..."
  }
}
```

### POST /events/append

Appends a domain event for the current task and returns the committed event metadata.

Request:

```json
{
  "taskId": "task_001",
  "event": {
    "type": "PLAN_CREATED",
    "category": "domain_event",
    "producer": "planAgent",
    "trace_id": "task_001",
    "span_id": "span_plan_001",
    "parent_span_id": null,
    "run_id": "run_task_001",
    "payload": {},
    "idempotency_key": "PLAN_CREATED:task_001:2"
  },
  "expectedSeq": 1
}
```

Response:

```json
{
  "ok": true,
  "event": {
    "event_id": "evt_2",
    "task_id": "task_001",
    "seq": 2,
    "schema_version": "1",
    "created_at": "..."
  }
}
```

## Optional Endpoints

### POST /trace/rebuild

Rebuilds a trace or node graph from recorded events. This can be used for debugging, replay, or recovery.

### GET /events/safe/:taskId

Returns a safe, privacy-aware list of events for a task. This endpoint should redact sensitive payload fields before returning data.

### POST /eval/run

Runs evaluation logic against events, traces, or built context. This endpoint is optional for runtime execution and can be introduced later for quality checks.

## AgentName Mapping

The Python runtime maps action names to Context Service agent names as follows:

| Action | AgentName |
| --- | --- |
| `make_plan` | `planAgent` |
| `generate_patch` | `codegenAgent` |
| `review_patch` | `deliveryAgent` |
| `execute_patch` | `repairAgent` |
| `verify_result` | `deliveryAgent` |
| `finish` | `deliveryAgent` |

## Error Response Format

The wrapper should return structured errors:

```json
{
  "ok": false,
  "error": {
    "code": "CONTEXT_BUILD_FAILED",
    "message": "...",
    "details": {}
  }
}
```

Recommended error codes include:

- `CONTEXT_BUILD_FAILED`
- `EVENT_APPEND_FAILED`
- `EXPECTED_SEQ_CONFLICT`
- `INVALID_REQUEST`
- `INTERNAL_ERROR`

## Python Runtime Switch

Current default:

```python
USE_CONTEXT_HTTP = False
```

Future HTTP-backed mode:

```python
USE_CONTEXT_HTTP = True
RealContextHttpAdapter(base_url="http://localhost:8080")
```

The intended replacement path is:

```text
MockContextHttpAdapter
↓
RealContextHttpAdapter
```

No Python agent workflow changes should be required when the real adapter preserves this contract.
