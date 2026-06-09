# Task 13.6-C Frontend Persistence Wiring

## 修改范围

- `src/api/persistenceClient.js`
- `src/api/persistenceClient.test.js`
- `src/components/AppShell.jsx`
- `src/components/WorkspaceShell.jsx`
- `src/components/WorkspaceProjectPicker.jsx`
- `src/components/DSLWorkbench.jsx`
- `src/components/DSLStatusConsole.jsx`
- `src/components/ClarificationChat.jsx`
- `src/components/DesignPlanningWorkbench.jsx`
- `src/components/ReviewCheckWorkbench.jsx`
- `src/components/PRWorkbench.jsx`
- `src/components/frontendPersistence.test.jsx`
- `reporting/frontend_persistence_report.md`
- `reporting/frontend_persistence_summary.json`

## 页面接入结果

- 项目选择页：项目列表读取 `GET /api/projects`；新建项目调用 `POST /api/projects`；选择后使用后端返回的真实 `projectId`；空列表展示 empty state；pending optimistic id 不再触发 requirement 404。
- DSL 澄清页：新 PM 输入与系统回复分别写入 `POST /api/requirements/:requirementId/clarifications`；页面打开时读取历史；DSL draft/readiness 从 requirement API 恢复；本轮 DSL run 结果回写 requirement。
- 设计规划页：读取 `GET /api/requirements/:requirementId/design-plan` 与 `GET /api/design-plans/:planId/tasks`；任务状态修改调用 `PATCH /api/planning-tasks/:taskId`；新 requirement 会初始化一个空设计规划容器，避免 optional 设计规划以 404 作为空态。
- 审阅检查页：读取 `GET /api/agent/runs/:runId/review`；人工状态修改调用 `PATCH /api/review-items/:reviewItemId`。
- PR 页面：读取 `GET /api/requirements/:requirementId/pr-draft`；保存统一走 `POST /api/requirements/:requirementId/pr-draft` upsert，避免同一 requirement 下多 draft id 分叉；保存时以当前可见表单值为准，checklist checked 状态可持久化。
- Agent dry-run 编排入口：状态和 artifacts 从 API 读取；仍保持 dry-run 默认，不在前端触发真实写文件。

## API client 变更

- 扩展 persistence client：requirements、clarifications、design plan upsert、planning tasks、agent artifacts、review items、PR draft upsert/update。
- 统一网络、JSON、非 2xx envelope 错误为可读 `Error.message`，供页面展示。

## 重启持久化验证

验证方式：启动本地后端和前端，使用临时 SQLite `F:\OpenClaw\tmp\task13_6c_restart_verify.sqlite` 做 UI/API 联合验证，不写入仓库 `data/`。

步骤结果：

1. 启动后端和前端：通过。
2. 新建项目：`Task 13.6C Restart Project`，后端项目 id `project-cc90ec57-de0e-44a6-a124-7c8936ab8a18`。
3. 输入 PM 需求并保存一轮澄清：requirement `req-4d846d41-c46d-43ae-a9f9-54d8b3b84f8d`，clarification turns = 2。
4. 切到设计规划页，修改任务状态：`Restart persistence task` 更新为 `done`。
5. 切到审阅检查页，修改 review item 状态：run `RUN-20260609-181317-L82G7` 的 review item 更新为 `approved`。
6. 切到 PR 页，保存 PR 草稿：PR title `Task 13.6C persisted PR draft`，checklist checked 状态保存。
7. 关闭后端：通过。
8. 重新启动后端：通过。
9. 刷新/重读数据：通过 API 复核。
10. 确认数据还在：项目、澄清历史、任务状态、review 状态、PR 草稿和 checklist 均保留。

## 测试结果

- `npm test`：通过，9 files / 97 tests。
- `npm run build`：通过。
- `npm run smoke`：通过。
- `node scripts\verify-render.mjs`：通过。执行时使用临时 `WORKBENCH_DB_PATH` 和外部 Playwright preload 延长默认等待，以规避本机 Vite 冷启动超过脚本默认 30s locator timeout；源码验证目标未修改。

## 安全检查

- 未提交 API key。
- 未提交 `configs/api_config.local.json`。
- 未提交 `*.local.json`。
- 未提交 `.env` / `.env.*`。
- 未提交 `data/*.sqlite` / `*.db`。
- 未提交 `runs/`。
- 未提交 `node_modules/`。
- 未提交 `dist/`。
- 未 push，未 force push。

## 备注

- 未修改 `server/db/`、`server/repositories/`、`server/routes/`。
- 当前工作树包含 Codex-B/P0 相关未提交文件；本任务提交只纳入前端和本报告允许范围。
