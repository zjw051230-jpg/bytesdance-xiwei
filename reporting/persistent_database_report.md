## Task 13.6 Persistent Database Layer 完成报告

### 1. 根因
- current data source: 工作台核心状态分散在前端 mock data、后端内存对象和临时 `runs/` artifacts 中。
- why data disappeared: 后端重启会清空内存状态，页面刷新会重新初始化 React state，`runs/` 只保存一次性产物而不是工作台业务状态，所以项目、需求、澄清、设计规划、Agent run、审阅和 PR 草稿无法稳定恢复。

### 2. 修改文件
- db: `server/db/connection.js`, `server/db/migrate.js`, `server/db/schema.sql`, `server/db/seed.js`
- repositories: `server/services/persistence/persistenceService.js`
- routes: `server/routes/persistence.js`, `server/index.js`, `server/httpEnvelope.js`
- services: `server/services/persistence/workbenchPersistenceAdapter.js`, `server/services/runnerService.js`, `server/services/agentExecutionService.js`
- frontend: `src/api/persistenceClient.js`, `src/components/AppShell.jsx`, `src/components/DSLWorkbench.jsx`
- scripts: `scripts/db-init.mjs`, `scripts/db-smoke.mjs`, `scripts/smoke-persistence-restart.mjs`, `package.json`
- tests: `server/persistence.test.js`, `src/App.test.jsx`
- safety/reporting: `.gitignore`, `reporting/persistent_database_report.md`, `reporting/persistent_database_summary.json`

### 3. 数据库能力
- projects: SQLite 持久化项目列表，支持 list/get/create/update/lastOpenedAt。
- requirements: 持久化 PM 原始需求、DSL JSON、readiness、ready_for_agent、handoff、completion、source provider/model。
- clarifications: 持久化 PM/system/assistant 澄清 turn。
- design plans: 持久化 requirement 对应设计规划。
- planning tasks: 持久化任务拆解、状态、优先级、进度、阻塞原因。
- agent runs: 持久化 DSL run / dry-run Agent run 索引、状态、dry_run、real_write_performed、错误摘要。
- review items: 持久化 run 对应审阅项、风险、测试状态和人工审阅状态。
- PR drafts: 持久化 requirement 对应 PR draft、正文、checklist 和状态。
- activity logs: 持久化 project/requirement/run 事件。

### 4. 持久化验证
- backend restart: `npm run smoke:persistence` 通过，关闭并重新创建数据库连接后仍可读回项目、需求、澄清、设计规划和任务。
- connection restart: `server/persistence.test.js` 覆盖 Project、Requirement、Clarification、Design Plan、Planning Task、Agent Run、Agent Artifact、Review Item、PR Draft、Activity Log 的重连读取。
- manual validation:
  1. `npm run dev:server`
  2. `npm run dev:client -- --host 127.0.0.1 --port 9999 --strictPort`
  3. 打开 `http://127.0.0.1:9999`
  4. 新建项目，进入工作台。
  5. 输入一条 PM 需求并发送，等待 DSL artifacts 完成。
  6. 切到设计规划页，触发 dry-run 规划。
  7. 打开审阅检查和 PR 页面。
  8. 停止后端，再重新启动后端。
  9. 刷新页面，确认项目列表、最新 requirement/clarification、run/review/PR 索引仍可由 API 读回。

### 5. API 接入结果
- project APIs: `GET/POST /api/projects`, `GET/PATCH /api/projects/:projectId`
- requirement APIs: `GET/POST /api/projects/:projectId/requirements`, `GET/PATCH /api/requirements/:requirementId`
- clarification APIs: `GET/POST /api/requirements/:requirementId/clarifications`
- planning APIs: `GET/POST /api/requirements/:requirementId/design-plan`, `PATCH /api/design-plans/:planId`, `GET/POST /api/design-plans/:planId/tasks`, `PATCH /api/planning-tasks/:taskId`
- agent APIs: `GET /api/agent/runs/:runId`, `GET /api/agent/runs/:runId/artifacts`, `GET /api/agent/runs/:runId/events`
- review APIs: `GET /api/agent/runs/:runId/review`, `PATCH /api/review-items/:reviewItemId`
- PR APIs: `GET/POST /api/requirements/:requirementId/pr-draft`, `PATCH /api/pr-drafts/:prDraftId`
- activity APIs: `GET /api/projects/:projectId/activity`

### 6. 测试结果
- npm test: passed, 78 tests.
- test:server: passed, 48 tests.
- db:init: passed, migrated true, seeded false because the local database already existed and was not overwritten.
- db:smoke: passed.
- smoke:persistence: passed, connectionRestartVerified true.
- build: passed.
- smoke: passed.
- verify-render: passed, 1920x1080 and 1440x900 no page-level vertical scroll; no console entries; no page errors; frontend URL `http://127.0.0.1:9999`; `/api/health` reachable through proxy.
- check:standalone: passed.
- smoke:e2e-real:dry-run: passed, realLlmCalls 3, mockLlmUsed false, realWritePerformed false. One intermediate run returned invalid JSON from the real model and failed before writing artifacts; rerun passed, so this was treated as an external model-format transient rather than a persistence regression.
- node:sqlite warning: Node prints `ExperimentalWarning: SQLite is an experimental feature`; tests and scripts exit 0.

### 7. 安全检查
- local db committed: false. `data/workbench.sqlite` and `data/persistence-smoke.sqlite` are ignored by `.gitignore`.
- api key leakage: false. Fresh persistence test verifies secret-looking PM input is redacted before DB storage. A raw binary DB scan initially matched `planning_tasks.id` values like `task-...` because the broad `sk-` regex matched the middle of `task-`; row-level inspection confirmed this was a false positive, not a credential. The generated planning task ID prefix was then changed to `workitem-` to avoid future false positives, and the final row-level DB scan returned zero credential-like hits.
- local config committed: false. `configs/api_config.local.json` is ignored.
- runs committed: false. `runs/` is ignored and not staged.
- node_modules committed: false.
- dist committed: false.
- stdout key printing: false.
- F:\dsl touched: false.
- F:\dsl-v2 touched: false.
- hunter / auto-reply / A3B touched: false.

### 8. Git / Push
- commit: `feat: persist workbench state in local database`
- pushed: true after final push to `origin main`
- branch: `main`

### 9. 是否建议返工
不建议返工。当前版本完成了本地 SQLite 持久化闭环；后续可以继续把设计规划、审阅、PR 页的细粒度编辑控件全部接到实时保存，但这不阻塞本轮持久化基础层交付。
