# Troubleshooting

## buildContextForAgent 返回空

检查：

- `currentNodeId` 是否存在于 `trace_view`。
- Python `span_id` 是否被映射为 JS trace node id。
- 是否已经先写入 `PLAN_CREATED` / `PATCH_GENERATED` / `EXECUTION_COMPLETED` 等事件。
- 是否调用过 `POST /trace/rebuild` 验证 trace。

处理：

```bash
curl -X POST http://127.0.0.1:4000/trace/rebuild \
  -H "content-type: application/json" \
  -d '{"taskId":"task_001"}'
```

确认返回的 nodes 中存在你传给 `/context/build` 的 `currentNodeId`。

## dependency chain 断了

检查：

- `parent_span_id` 是否传对。
- `PATCH_GENERATED` 是否映射为 `PATCH_CREATED`。
- `EXECUTION_COMPLETED` 是否映射为 `SANDBOX_RESULT_RECORDED`。
- `REVIEW_COMPLETED` 是否生成了 `TRACE_NODE_APPENDED` + `TRACE_EDGE_APPENDED`。

推荐链路：

```text
sandbox_6 -> review_5 -> patch_4 -> plan_2 -> dsl_root
```

## expectedSeq 冲突

处理：

- 以 `GET /events/latest-seq/:taskId` 为准。
- 不要本地猜 seq。
- 写入失败后先重新读取 latest seq，再按 Runtime 策略重试。

```bash
curl http://127.0.0.1:4000/events/latest-seq/task_001
```

## Python 请求读不到 event_id

Wrapper 响应有 top-level 字段：

```json
{
  "event_id": "evt_10",
  "seq": 10,
  "latest_seq": 10
}
```

不要只从 `event` 对象内部读取。对于一个输入映射为多个标准事件的情况，也可以读 `appended_events`。

## secret 暴露

处理：

- 使用 `GET /events/safe/:taskId`。
- 不要直接读 raw events 文件。
- 不要把 `.env`、API key、token、secret 写进 payload。
- 不要把 `full_sandbox_log`、`full_patch_diff`、`raw_payload` 这类大字段作为上下文消费对象。

## idempotency 冲突

检查同一个 `idempotency_key` 是否被不同 payload 重复使用。对同一事件重试时 key 可以相同；对不同事件必须使用不同 key。

