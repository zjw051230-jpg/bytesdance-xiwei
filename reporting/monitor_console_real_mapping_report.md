## Monitor Console Real Mapping 完成报告

### 1. 初始工作区状态

* branch: `main`
* uncommitted files: 启动审计时已有 `agent(2)/agent/agent_core/storage/states/demo_task.json`、`reporting/agent1_inventory.json` 等未提交改动；当前还检测到 DSL gate 相关文件处于修改状态，包括 `server/services/skillOrchestrator.js`、`server/server.test.js`、`src/components/DSLWorkbench.jsx`、`src/adapters/dslArtifactAdapter.js` 等。
* conflict with DSL score task: 有冲突风险。当前失败测试集中在 DSL score/question gate 与 skill prompt 断言，本任务未继续修改这些核心逻辑文件，也未提交。

### 2. Mock 扫描结果

* total matches: 4219
* production_mock: 0
* test_fixture: 819
* safe_fallback: 181
* docs_only: 668
* unknown: 2551

### 3. 已替换的生产 mock

| file | old mock | real source | new behavior |
| ---- | -------- | ----------- | ------------ |
| `src/data/mockData.js` | 监控台主数据 fixture | persistence APIs / active project state | 删除生产 mock 数据源 |
| `src/data/workspaceProjects.js` | 默认项目列表 | `/api/projects` | 生产环境空数组，仅测试环境用 fixture |
| `src/components/AppShell.jsx` | 生产 fallback project | persistence project list + active project | 监控台默认读取后端项目，失败时显示空态/错误 |
| `src/api/monitorClient.js` | 无统一真实加载入口 | requirements、activity、design plan、tasks、agent runs、artifacts、review、PR draft APIs | 聚合监控台所需真实数据 |
| `src/adapters/monitorConsoleAdapter.js` | 硬编码 run/score/risk/file | API 返回数据与 DSL artifact state | 构建可为空的监控台模型 |
| `src/components/Sidebar.jsx` / `ProjectOverview.jsx` / `TaskInspector.jsx` | 固定项目、timeline、run、artifact | monitor model | 无数据时显示 empty state |
| `src/components/RunList.jsx` / `PendingReportsQueue.jsx` / `CheckpointStrip.jsx` / `TaskTimeline.jsx` | canned activity/run/report | monitor model | 只展示真实 run/activity/artifact |
| `src/components/RequirementReportModal.jsx` | 导出 mock 文案 | 当前导出服务状态 | 不再把未接入能力标成 mock 成功 |

### 4. 保留的 fixture / fallback

| file | reason | boundary |
| ---- | ------ | -------- |
| `src/App.test.jsx` | 测试 persistence-backed monitor fixture | 仅 Vitest 测试使用 |
| `src/components/AppShell.jsx` | test mode initial project fixtures | 仅 `import.meta.env.MODE === "test"`，避免旧测试 fetch stub 不提供 `/api/projects` 时阻塞 |
| `server/**/*.test.js` | 后端测试 fixture 和 redaction 用例 | 不进入生产 UI |
| `reporting/*.md` / `reporting/*.json` | 历史报告文本 | docs/report only |
| `server/services/configPath.js` 等 | local config fallback warning | 仅安全 fallback / 配置提示 |

### 5. 监控台真实映射

* Project: `/api/projects` + activeProjectId，字段包括 id、name、localPath、updatedAt。
* Requirement: `/api/projects/:projectId/requirements`，选择当前 requirement 后继续读取规划和 PR。
* DSL: requirement / artifact / adapter state，监控台只读映射，不重新计算 DSL gate。
* Score: 来自 DSL artifact / adapter 输出的 rawScore、displayScore、scoreStatus。
* Risks: 来自 DSL artifact / risk state；无真实风险时显示 empty state。
* Readiness: 来自 DSL state / handoff decision；无真实 run 时不伪造 ready。
* Agent: `/api/agent/runs/:runId`、artifacts、events/review 数据；无真实 run 显示 empty state。
* Review: persistence review items 或 agent workflow review；不再展示固定 `LoginForm.jsx` / `ErrorMessage.jsx` mock 文件。
* PR: `/api/requirements/:requirementId/pr-draft`；无 draft 显示 empty state。
* Activity: `/api/projects/:projectId/activity`。
* Report CTA: 绑定真实 artifact/report path/status；无 artifact 不显示假成功。

### 6. 未触碰范围

* DSL score formula: 未主动修改。
* DSL question gate: 未主动修改。
* agent2: 未修改，未执行真实 Agent。
* skills: 未修改。
* performance: 未修改 `vite.config.js`，未做重启/kill。
* review/pr unrelated logic: 未做超出监控台真实映射范围的业务改造。

### 7. 测试结果

* mock audit: 通过，`production_mock=0`。
* npm run build: 通过。
* npm test: 未通过，149/152 passed；失败 3 个均为 DSL gate / skill prompt 相关断言：
  * `src/App.test.jsx`: `继续丰富需求` 按钮未出现。
  * `server/server.test.js`: refinement displayScore 72 低于期望 75。
  * `server/server.test.js`: prompt diagnostics contextMessageCount 为 10，期望 6。
* test:server: 未通过，89/91 passed；失败 2 个均为上述 server DSL 断言。

### 8. 安全检查

* api key leakage: 未发现本任务新增真实 API key；扫描命中均为既有测试 fixture、redacted 文本或历史报告路径说明。
* local config committed: false，暂存区为空。
* local db committed: false。
* runs committed: false。
* node_modules committed: false。
* dist committed: false；`npm run build` 生成的 `dist/` 未纳入 Git。
* real repo write performed: false。

### 9. Git / Push

* commit: 未执行，原因是测试未通过且存在 DSL 并行任务冲突风险。
* pushed: false。
* branch: `main`。

### 10. 是否建议返工

不建议返工监控台真实映射本身；建议先由 DSL Score Monotonic Question Gate 任务收敛当前 DSL 测试失败，再复跑 `npm test` 和 `npm run test:server`。测试全绿后，再只暂存本任务相关文件提交，避免带入 `agent(2)`、DSL gate 并行改动、`dist/` 或本地配置。
