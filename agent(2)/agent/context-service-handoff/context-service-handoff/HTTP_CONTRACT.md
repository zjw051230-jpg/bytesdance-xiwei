# HTTP Contract

Base URL 默认：

```text
http://127.0.0.1:4000
```

所有接口同时支持 root path 和 `/api/context/*` alias。

## GET /context/health

Alias：

```text
GET /api/context/health
```

响应：

```json
{
  "ok": true,
  "service": "context-http-wrapper",
  "storage_root": "..."
}
```

## POST /events/append

Alias：

```text
POST /api/context/events/append
```

请求示例：

```json
{
  "taskId": "task_001",
  "event": {
    "type": "PATCH_GENERATED",
    "category": "domain_event",
    "producer": "codegenAgent",
    "trace_id": "task_001",
    "span_id": "patch_4",
    "parent_span_id": "plan_2",
    "run_id": "run_task_001",
    "payload": {
      "summary": "Generate patch for article word stats",
      "patch_plan": {}
    },
    "idempotency_key": "PATCH_GENERATED:task_001:4"
  },
  "expectedSeq": 3
}
```

响应示例：

```json
{
  "ok": true,
  "event_id": "evt_10",
  "seq": 10,
  "latest_seq": 10,
  "event": {},
  "appended_events": []
}
```

说明：

- Wrapper 会先通过 `ContextEventMapper` 把 Python Agent 事件映射为 Context Service 标准事件。
- 一个输入事件可能追加多个标准事件，例如 `PLAN_CREATED` 会补齐 `TASK_CREATED`、`DSL_FINALIZED`、`PLAN_CREATED`。
- 响应中的 `event_id` / `seq` 指向本次提交的最后一个事件。
- `appended_events` 包含本次真实写入的全部标准事件。
- 对接方可以传 `expectedSeq`，但 Memory Adapter 仍应以服务端返回的 `latest_seq` / `seq` 为准。

## POST /context/build

Alias：

```text
POST /api/context/build
```

请求：

```json
{
  "taskId": "task_001",
  "agentName": "repairAgent",
  "currentNodeId": "sandbox_6"
}
```

响应：

```json
{
  "ok": true,
  "data": {
    "task_id": "task_001",
    "agent_name": "repairAgent",
    "current_node_id": "sandbox_6",
    "context": {},
    "source_node_ids": [],
    "source_event_ids": [],
    "budget_report": {},
    "privacy_report": {},
    "created_at": "..."
  },
  "latest_seq": 12
}
```

`agentName` 当前支持：

```text
planAgent
codegenAgent
repairAgent
deliveryAgent
```

## GET /events/latest-seq/:taskId

Alias：

```text
GET /api/context/events/latest-seq/:taskId
```

响应：

```json
{
  "ok": true,
  "task_id": "task_001",
  "latest_seq": 12
}
```

## GET /events/safe/:taskId

Alias：

```text
GET /api/context/events/safe/:taskId
```

响应：

```json
{
  "ok": true,
  "task_id": "task_001",
  "events": [],
  "latest_seq": 12
}
```

`events` 是 redaction overlay 后的安全事件。对接方不要直接读取 raw event 文件。

## POST /trace/rebuild

Alias：

```text
POST /api/context/trace/rebuild
```

请求：

```json
{
  "taskId": "task_001"
}
```

响应：

```json
{
  "ok": true,
  "data": {
    "trace_view": {
      "nodes": [],
      "edges": []
    },
    "projection_report": {}
  },
  "latest_seq": 12
}
```

## 错误格式

```json
{
  "ok": false,
  "error": {
    "code": "EXPECTED_SEQ_CONFLICT",
    "message": "...",
    "details": {}
  }
}
```

常见错误码：

```text
INVALID_REQUEST
EXPECTED_SEQ_CONFLICT
IDEMPOTENCY_CONFLICT
INTERNAL_ERROR
```

