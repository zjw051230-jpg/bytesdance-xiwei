## Agent StageEvents Initialization Fix 完成报告

### 1. 根因

* stageEvents before initialization 来源：后端在构造 `buildAgentStageEvents(...)` 参数时，把尚未完成初始化的 `stageEvents` 写进 `plan: { ...plan, stageEvents, activityTimeline: stageEvents }`，触发 JavaScript temporal dead zone runtime error。
* affected file: `server/services/agentExecutionService.js`, `server/services/agent2Adapter.js`
* affected path: `/api/agent/run` 生成 Agent dry-run / Agent(2) workbench preview 时的 response 构造路径。

### 2. 修复内容

* backend guard: 先调用 `buildAgentStageEvents(...)` 完成 `stageEvents` 初始化，再挂载到 `plan.stageEvents` / `plan.activityTimeline` / response / artifact。
* frontend fallback: 设计规划页读取 run/artifacts/workflow 时统一通过数组兜底，非数组或缺失值会转为空数组。
* empty state: 没有 agent run 时显示“尚未启动 Agent dry-run。点击生成执行计划后，将在这里展示各阶段活动状态。”
* failed state boundary: stageEvents 缺失不再标记 run failed；只有后端明确返回 error 或 failed status 才进入异常状态。

### 3. 安全边界

* dryRun: preserved for dry-run path。
* realWritePerformed: preserved false for dry-run path。
* real repo write: not performed by this fix。

### 4. 未触碰范围

* DSL score/question gate: not touched。
* new project bootstrap: not touched。
* monitor mapping: not touched。
* skills: not touched。
* agent2 raw dir: not touched。
* vite/performance: not touched。

### 5. 跳过测试说明

* skipped tests: yes, per user instruction。
* integration gate required: yes。

### 6. Git / Push

* commit: see final response。
* pushed: see final response。
* branch: ZJWNB。
