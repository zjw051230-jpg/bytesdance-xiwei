## Agent Activity Timeline 完成报告

### 1. 修改文件

* `server/routes/agentExecution.js`
* `server/services/agentExecutionService.js`
* `server/services/agent2Adapter.js`
* `src/api/agentClient.js`
* `src/adapters/agentWorkflowAdapter.js`
* `src/components/AgentActivityTimeline.jsx`
* `src/components/AgentRunStatusPanel.jsx`
* `src/components/DesignPlanningWorkbench.jsx`
* `src/components/TaskTimeline.jsx`
* `src/components/TaskInspector.jsx`
* `reporting/agent_activity_timeline_report.md`
* `reporting/agent_activity_timeline_summary.json`

### 2. stageEvents schema

每个 stage event 使用以下字段：

```json
{
  "id": "RUN-id:stage-key",
  "key": "requirement",
  "agent": "RequirementAgent",
  "title": "读取 RequirementDSL / 设计输入",
  "summary": "human readable summary",
  "status": "idle | running | completed | skipped | blocked | failed",
  "startedAt": "ISO datetime",
  "finishedAt": "ISO datetime",
  "errorSummary": "",
  "order": 1
}
```

固定阶段：

1. RequirementAgent
2. ReadinessAgent
3. ContextAgent
4. PlannerAgent
5. LocatorAgent
6. PatchPlanAgent
7. ReviewAgent
8. PRDraftAgent
9. ArtifactAgent
10. SummaryAgent

### 3. 前端展示效果

设计规划页的 Agent 入口改为 dry-run 语义，点击“生成执行计划”后展示 Agent Activity Timeline。任务拆解清单下方会显示完整阶段列表，Agent 状态面板会显示 dryRun、realWritePerformed、completed 和 skipped 数量。

### 4. empty state 行为

没有 agent run 时显示：

“尚未启动 Agent dry-run。点击生成执行计划后，将在这里展示各阶段活动状态。”

### 5. completed run timeline 行为

run 即使很快完成，也会把后端返回的 stageEvents 保存在 `agentWorkflow.stageEvents/activityTimeline` 中继续展示。`/api/agent/run`、`/api/agent/runs/:runId`、`/api/agent/runs/:runId/events` 都能返回 stageEvents。

### 6. 是否真实写 repo

否。设计规划页现在发送 `dryRun: true`，并在状态面板明确展示 `realWritePerformed=false`。本任务未执行真实 Agent 写入，也未写业务 repo。

### 7. 是否触碰 DSL score / monitor mapping / skills / agent(2)

* DSL score / question gate: 未触碰。
* Monitor Console real mapping: 未触碰核心映射逻辑。
* skills: 未触碰。
* agent(2): 未触碰原始目录；已有 dirty/pycache 保持不动。

### 8. skipped tests

yes, per user instruction. 未执行：

* `npm test`
* `npm run test:server`
* `npm run build`
* `npm run dev`
* `npm run smoke`
* `npm run verify`

已执行的非测试静态检查：

* `node --check server/services/agent2Adapter.js`
* `node --check server/services/agentExecutionService.js`
* `node --check server/routes/agentExecution.js`
* `node --check src/api/agentClient.js`
* `node --check src/adapters/agentWorkflowAdapter.js`
* JSX esbuild in-memory parse for touched JSX components

### 9. Git / Push

* commit: pending
* pushed: pending
* branch: main

### 10. 安全与边界

未提交 API key、local config、local DB、runs、node_modules、dist。未 force push。未 `git add .`。
