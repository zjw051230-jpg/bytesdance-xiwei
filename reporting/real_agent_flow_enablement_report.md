Real Agent Flow Enablement 完成报告

1. 修改文件
- server/services/agentExecutionService.js
- server/services/agent2Adapter.js
- server/agent2Route.test.js
- server/server.test.js
- server/persistence.test.js
- src/api/agentClient.js: no change
- src/adapters/agentWorkflowAdapter.js
- src/components/DesignPlanningWorkbench.jsx
- reporting/real_agent_flow_enablement_report.md
- reporting/real_agent_flow_enablement_summary.json

2. Real-run 入口
- route: POST /api/agent/run
- service: startAgentRun 分流 dry-run 与 confirmed real-run
- adapter: runRealAgent2 启动 Agent(2) runtime
- frontend trigger: “开始真实 Agent 执行”按钮，点击后 window.confirm 二次确认

3. 安全边界
- dryRun false required: true
- realRunConfirm required: true
- provider required: agent2
- repoPath validation: 必须存在且为目录
- forbidden paths: .env, *.local.json, api_config.local.json, data/*.sqlite, *.db, node_modules/**, dist/**, runs/**, .git/**
- workbench self-write blocked: true

4. Agent(2) 调用
- entrypoint: agent(2)/agent/agent_core/main.py via python -m agent_core.main
- input contract: stdin JSON RequirementDSL
- output contract: stdout JSON
- stdout JSON: AGENT_OUTPUT_JSON=1，解析失败返回 failed run
- error handling: process failure / timeout / invalid JSON 会生成 failed run，不 fallback 为 dry-run success

5. 执行结果映射
- changed files: execution_result.files 与目标 repo baseline diff 双重映射
- artifacts: agent2 request/stdout/stderr/activity timeline 写入 run artifact
- review: Agent(2) review_result 映射到 Workbench review
- PR draft: Agent(2) pr_draft 映射到 Workbench prDraft
- stageEvents: buildAgentStageEvents 生成真实 run timeline
- realWritePerformed: 只有 Agent(2) 报告写入且目标 repo diff 非空时为 true

6. 最小验证
- full tests skipped: true
- static check: git diff --check passed
- targeted tests: npx vitest run server/agent2Route.test.js server/agent2Adapter.test.js passed; npx vitest run server/server.test.js -t "creates real agent artifacts|blocks real agent execution" passed; npx vitest run server/persistence.test.js -t "persists agent run read APIs|persists review item update APIs|persists PR draft save/read APIs|creates baseline snapshots|resets the full run workspace" passed
- smoke run: not executed because F:\ds\conduit-realworld-example-app does not exist
- target repo changed files: temp test repos only, no Workbench repo writes

7. 安全检查
- api key leakage: none found in staged diff scan before commit
- local config committed: false
- db committed: false
- runs committed: false
- dist committed: false
- node_modules committed: false
- workbench repo write: false
- target repo write: only mock real-run temp test repositories

8. Git / Push
- commit: 8b956a4
- pushed: pending at report generation time
- branch: ZJWNB
