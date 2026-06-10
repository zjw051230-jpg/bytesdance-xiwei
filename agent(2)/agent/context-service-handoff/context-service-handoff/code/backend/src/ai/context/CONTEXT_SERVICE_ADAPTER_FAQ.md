# Context Service 对接确认

本文面向 Agent Runtime / Memory Adapter 对接方，说明当前 Context Service 的可用接口、事件格式、调用时机和边界。

## 1. buildContextForAgent 输入输出

当前是函数调用接口，不是 HTTP API。

```js
const { agentContextBuilder } = require("./backend/src/ai/context");

const agentContext = agentContextBuilder.buildContextForAgent({
  taskId: "task_001",
  agentName: "repairAgent",
  currentNodeId: "sandbox_001",
});
```

入参：

```json
{
  "taskId": "task_001",
  "agentName": "repairAgent",
  "currentNodeId": "sandbox_001"
}
```

`agentName` 当前支持：

```text
planAgent
codegenAgent
repairAgent
deliveryAgent
```

典型返回：

```json
{
  "task_id": "task_001",
  "agent_name": "repairAgent",
  "current_node_id": "sandbox_001",
  "context": {
    "final_dsl_core": {
      "value": [],
      "source_node_ids": ["dsl_001"]
    },
    "dependency_summary": {
      "value": {
        "source_node_ids": ["sandbox_001", "patch_001", "plan_001", "dsl_001"]
      },
      "source_node_ids": ["sandbox_001", "patch_001", "plan_001", "dsl_001"]
    },
    "failed_patch_summary": {
      "value": [],
      "source_node_ids": ["patch_001"]
    },
    "sandbox_error_summary": {
      "value": [],
      "source_node_ids": ["sandbox_001"]
    },
    "verified_plan_summary": {
      "value": [],
      "source_node_ids": ["plan_001"]
    },
    "active_interrupts": {
      "value": [],
      "source_node_ids": []
    }
  },
  "source_node_ids": ["sandbox_001", "patch_001", "plan_001", "dsl_001"],
  "source_event_ids": ["evt_2", "evt_3", "evt_4", "evt_5"],
  "budget_report": {
    "before_chars": 1200,
    "after_chars": 980,
    "truncated_fields": [],
    "removed_fields": []
  },
  "privacy_report": {
    "redacted": false,
    "redacted_paths": []
  },
  "created_at": "2026-06-07T00:00:00.000Z"
}
```

`buildContextForAgent` 内部会执行：

```text
rebuildTraceView
  -> getDependencyChain
  -> buildDependencySummary
  -> ContextBudgetManager.applyContextBudget
  -> PrivacyFilter.redactSensitiveObject
  -> write filtered context_cache
  -> append lightweight CONTEXT_BUILT event
```

`CONTEXT_BUILT` 是当前 Context Service 标准事件名；`AGENT_CONTEXT_BUILT` 是 `TraceProjector` 兼容的历史 alias。两者都不能携带 `full_context`。

## 2. appendEvent 事件格式

示例：

```js
eventStore.appendEvent("task_001", {
  type: "PLAN_CREATED",
  category: "domain_event",
  producer: "planAgent",
  trace_id: "trace_001",
  span_id: "span_plan_001",
  parent_span_id: "span_dsl_001",
  run_id: "run_001",
  payload: {
    plan_node_id: "plan_001",
    summary: "Read article body, compute word count, and render it.",
    status: "verified",
    depends_on_node_ids: ["dsl_001"],
    metadata: {
      target_files: ["frontend/src/pages/Article.jsx"],
      verification_plan: ["npm test"]
    }
  },
  idempotency_key: "plan-created:task_001:plan_001"
}, {
  expectedSeq: 2
});
```

`EventStore` 会自动补：

```json
{
  "event_id": "evt_xxx",
  "task_id": "task_001",
  "seq": 3,
  "created_at": "2026-06-07T00:00:00.000Z",
  "schema_version": "1"
}
```

最小必填字段：

```json
{
  "type": "PLAN_CREATED",
  "payload": {}
}
```

Runtime / Memory Adapter 建议稳定传入：

```text
type
category
producer
trace_id
span_id
parent_span_id
run_id
payload
idempotency_key
expectedSeq
```

## 3. buildContextForAgent 调用时机

不建议每个 token 或每个底层 action 都调用。

建议在关键阶段入口调用：

```text
Planner 开始前 -> planAgent
Coder 开始前 -> codegenAgent
Repair 开始前 -> repairAgent
Delivery / Review 前 -> deliveryAgent
用户补充或中断后重新进入关键阶段 -> 再 build 一次
```

如果一个阶段执行时间较长，或者事件流发生了关键变化，也可以在阶段内重新构建上下文。

## 4. PrivacyFilter 和 ContextBudgetManager

`buildContextForAgent` 返回的数据已经经过：

```text
ContextBudgetManager
PrivacyFilter
```

Agent 侧默认不需要额外调用这两个接口。

Agent / Tool / Sandbox 侧应只消费 `buildContextForAgent` 返回的 filtered context，不要直接消费 raw events、raw sandbox log、full patch diff 或 full chat history。

## 5. task_id 生命周期

`task_id` 由 Runtime 管理。

Context Service 不创建任务生命周期，也不维护任务状态机。Runtime 应在任务创建时生成 `task_id`，之后写事件、重建 trace、构建 context、评估 context 都传同一个 `task_id`。

## 6. 增量上下文

当前没有专门的“增量上下文”接口。

已有读取接口：

```js
readEvents(taskId)        // raw events
readSafeEvents(taskId)    // redaction overlay 后的 safe events
readEventsByType(taskId, type)
getLatestEventSeq(taskId)
buildContextForAgent(...)
```

Runtime 可以用 `getLatestEventSeq` 自己记录 last seq 做增量判断。但当前 `buildContextForAgent` 每次会基于完整 trace view 重建 agent context。

## 7. 对外暴露方式

当前对外暴露方式是 CommonJS 函数 / SDK 调用，不是 HTTP API。

入口：

```js
const contextService = require("./backend/src/ai/context");
```

公共导出：

```text
eventStore
traceProjector
traceGraphStore
compactSummarizer
agentContextBuilder
contextBudgetManager
privacyFilter
contextEvalRunner
contextBenchmark
redactionManifest
```

Memory Adapter 第一版建议直接封装这些函数；如果 Runtime 是 Python，建议额外做一个很薄的 Node HTTP wrapper 或本地服务桥接。

## 8. 失败和空上下文降级策略

当前没有标准错误码。

建议 Runtime / Memory Adapter 侧按普通异常处理：

```js
try {
  const context = agentContextBuilder.buildContextForAgent({
    taskId,
    agentName,
    currentNodeId,
  });
} catch (error) {
  // Runtime 自行决定 fail fast / retry / fallback
}
```

推荐策略：

- `buildContextForAgent` 抛错时，不要让 Agent 在没有 context 的情况下盲跑。
- 可先调用 `rebuildTraceView(taskId)` 检查 `projection_report.errors`。
- 如果缺少 `currentNodeId`，当前会返回安全默认上下文，但质量可能不足。
- 写事件时如果遇到 `OptimisticConcurrencyError`，Runtime 应重新读取 latest seq 后再写。

## 9. 向量检索 / RAG 边界

当前核心 Context Service 不做向量检索或 RAG。

当前定位：

```text
event log
trace projection
dependency chain
summarization
agent context building
privacy filtering
redaction overlay
context evaluation
context benchmark
```

Memory Adapter 可以预留 `vector_top_k` 或 RAG provider 抽象，但当前正式对接不要依赖它。

当前目录里存在 repository index / retriever 辅助文件，但它们不是核心公开 Context Service 主链路。

