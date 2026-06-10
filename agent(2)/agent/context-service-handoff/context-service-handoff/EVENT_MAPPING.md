# Event Mapping

`ContextEventMapper` 用于兼容 Python Agent 当前事件名，并把 `span_id` / `parent_span_id` 转成 JS Context Service 的 trace node / depends_on edge。

## 映射表

| Python Agent event | Context Service event |
| --- | --- |
| `PLAN_CREATED` | `PLAN_CREATED`，并在缺失时补 `TASK_CREATED` + `DSL_FINALIZED` |
| `PATCH_GENERATED` | `PATCH_CREATED` |
| `REVIEW_COMPLETED` | `TRACE_NODE_APPENDED` + `TRACE_EDGE_APPENDED` |
| `EXECUTION_COMPLETED` | `SANDBOX_RESULT_RECORDED` |
| `VERIFICATION_COMPLETED` | `TRACE_NODE_APPENDED` + `TRACE_EDGE_APPENDED` |
| `TASK_FINISHED` | `TRACE_NODE_APPENDED`，如果有 parent 则追加 `TRACE_EDGE_APPENDED` |

## Node id 规则

- `span_id` 会作为 JS trace node id。
- `parent_span_id` 会变成 `depends_on` edge。
- `currentNodeId` 必须传 JS trace 中存在的 node id。
- 不要让 Python 本地生成一个 JS 不认识的 `current_node_id`。
- `appendEvent` 的 seq 以服务端返回为准。

## 推荐事件链

```text
dsl_root
  <- plan_2
  <- patch_4
  <- review_5
  <- sandbox_6
```

对应 Python event：

```text
PLAN_CREATED         span_id=plan_2    parent_span_id=null
PATCH_GENERATED      span_id=patch_4   parent_span_id=plan_2
REVIEW_COMPLETED     span_id=review_5  parent_span_id=patch_4
EXECUTION_COMPLETED  span_id=sandbox_6 parent_span_id=review_5
```

构建 repair context 时：

```json
{
  "taskId": "task_001",
  "agentName": "repairAgent",
  "currentNodeId": "sandbox_6"
}
```

期望 `source_node_ids` 包含：

```json
["sandbox_6", "review_5", "patch_4", "plan_2", "dsl_root"]
```

## 原始大字段处理

Mapper 会移除下列 raw 字段，避免把大日志和 diff 直接写入上下文：

```text
full_context
full_chat_history
full_sandbox_log
full_patch_diff
raw_payload
sandbox_log
patch_diff
```

