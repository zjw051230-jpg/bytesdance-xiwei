# Context Service 简要说明

## 功能定位

当前 `backend/src/ai/context` 是一个独立的上下文服务，用于为 Agent 提供安全、可追溯、可压缩、可评估的任务上下文。

它主要负责：

- 记录任务事件历史：通过 `EventStore` 保存需求、DSL、计划、补丁、测试结果等事件。
- 投影执行脉络：通过 `TraceProjector` 将事件重建为 `trace_view`。
- 构建依赖链：通过 `TraceGraphStore` 查询节点之间的 `depends_on` 关系。
- 摘要历史信息：通过 `CompactSummarizer` 压缩 patch、sandbox result、依赖链等内容。
- 构建 AgentContext：通过 `AgentContextBuilder` 为不同 Agent 生成不同上下文。
- 控制上下文大小：通过 `ContextBudgetManager` 移除或截断过大的字段。
- 过滤敏感信息：通过 `PrivacyFilter` 过滤 token、secret、API key 等敏感内容。
- 支持误写补救：通过 `RedactionManifest` 和 `readSafeEvents` 对已写入事件做读取时遮罩。
- 评估上下文质量：通过 `ContextEvalRunner` 评估召回率、噪声率、来源归因和隐私泄漏。
- 对比上下文策略：通过 `ContextBenchmark` 比较 `dependency_chain`、`recent_messages`、`global_summary` 等策略。

## 不负责的范围

当前 Context Service 不负责：

- Runtime
- Agent Loop
- Orchestrator
- Hook 调度
- Tool 执行
- Sandbox 执行
- 任务状态机
- 前端或人工审核 UI

## 核心链路

```text
appendEvent
  -> rebuildTraceView
  -> getDependencyChain
  -> buildDependencySummary
  -> buildContextForAgent
  -> PrivacyFilter
  -> runContextEvalCase
  -> benchmarkContextStrategies
```

## 当前测试结果

最近一次全量测试命令：

```bash
npm test
```

测试结果：

- `34` 个测试文件通过
- `208` 条测试通过
- 无失败测试

测试覆盖包括：

- 单元测试
- 端到端集成测试
- 契约测试
- 不变量测试
- 安全测试
- 失败模式测试
- 上下文质量 / benchmark 测试
- redaction 测试
- privacy 测试
- 本地性能 baseline 测试

## 当前交付状态

当前 Context Service 已完成去 Runtime 化收口，可以作为独立上下文模块交付。它不依赖 Runtime 主流程，也能通过端到端测试证明核心链路可用。
