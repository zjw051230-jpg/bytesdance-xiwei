# Smoke Test Checklist

联调前先完成这份 checklist。

- [ ] 启动 JS Context HTTP Wrapper。
- [ ] `GET /context/health` 返回 ok。
- [ ] Runtime 写 `PLAN_CREATED`。
- [ ] Runtime 写 `PATCH_GENERATED`。
- [ ] Runtime 写 `REVIEW_COMPLETED`。
- [ ] Runtime 写 `EXECUTION_COMPLETED`。
- [ ] `POST /trace/rebuild` 成功。
- [ ] `POST /context/build` `repairAgent` 成功。
- [ ] `source_node_ids` 包含 `sandbox_6` / `review_5` / `patch_4` / `plan_2` / `dsl_root`。
- [ ] `context` 不包含 `full_sandbox_log` / `full_patch_diff` / `secret`。
- [ ] `GET /events/safe/:taskId` 不暴露 raw secret。

## 推荐 smoke 数据

```text
taskId: task_001
trace_id: task_001
run_id: run_task_001
PLAN_CREATED.span_id: plan_2
PATCH_GENERATED.span_id: patch_4
REVIEW_COMPLETED.span_id: review_5
EXECUTION_COMPLETED.span_id: sandbox_6
```

## 示例脚本

- `examples/curl_smoke_test.ps1`
- `examples/curl_smoke_test.sh`
- `examples/minimal_event_chain.json`

