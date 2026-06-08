## Task 12.1-D DSL API Empty Response Fix Report

### 1. 原始问题
- error: `empty_response / Empty response from DSL API (500 Internal Server Error)`
- when it happened: Web UI 从需求澄清工作台发起 `/api/dsl/runs` 后，后端 500 路径可能返回空 body 或断开连接。
- why previous fix was insufficient: 前端已经安全读取 `response.text()`，但后端仍存在 route throw、超大 body、顶层 catch 未统一 envelope 的路径。

### 2. 根因
- backend route: `server/routes/dslRuns.js`
- missing catch: DSL route 内部没有覆盖所有异常路径；顶层 catch 返回 `server_error`，不生成 run 级 `server_error.json`。
- empty response source: `readJsonBody` 在 body 超过 2MB 时调用 `request.destroy()`，客户端可收到 `ECONNRESET` / 空响应。

### 3. 修改文件
- `server/httpEnvelope.js`
- `server/index.js`
- `server/routes/dslRuns.js`
- `server/routes/artifacts.js`
- `server/server.test.js`
- `src/App.test.jsx`
- `scripts/smoke-empty-response-regression.mjs`
- `package.json`
- `reporting/web_ui_empty_response_fix_report.md`
- `reporting/web_ui_empty_response_fix_summary.json`

### 4. 修复内容
- API envelope: 新增 `sendOk` / `sendError` / `writeJson` / `sendBackendException`，统一返回 `{ ok, data, error }`。
- async route handling: DSL route 增加 try/catch，内部异常返回 `backend_exception` JSON。
- global error handler: `server/index.js` 顶层异常也进入 `sendBackendException`，不再返回裸 `server_error`。
- body parser: 超大 body 不再 destroy socket，返回 `bad_request / Invalid JSON body`。
- error persistence: route/backend 异常写入 `runs/<runId>/server_error.json`，内容经过脱敏。
- runnerService: 既有 `runner_failed` / `runner_timeout` 仍保持结构化 error envelope。
- frontend display: App 层失败测试改为断言结构化 `backend_exception`，不再把 `empty_response` 当作期望 UI。

### 5. UI 复测结果
- from UI: true
- empty-response regression run id: `RUN-20260607-173155-TE4WP`
- regression status: passed
- `/api/dsl/runs` status: 500
- response body length: 294
- structured error appeared: true, `backend_exception`
- empty_response appeared: no
- system reply shown: yes
- right panel updated: yes
- `server_error.json` written: yes
- page vertical scroll: false
- real DSL smoke: `external_blocked`, runner returned structured `runner_timeout` for `RUN-20260607-172515-Z7RC0`; no empty response / no JSON parse error.

### 6. 测试命令
- `npm test`
- `npm run test:server`
- `npm run build`
- `npm run smoke`
- `node scripts\verify-render.mjs`
- `npm run smoke:web-ui-real-dsl`
- `npm run smoke:web-ui-l1-dedup`
- `npm run smoke:web-ui-empty-response-regression`

### 7. 测试结果
- `npm test`: passed, 6 files / 34 tests.
- `npm run test:server`: passed, 2 files / 11 tests.
- `npm run build`: passed.
- `npm run smoke`: passed.
- `node scripts\verify-render.mjs`: passed for 1920x1080 and 1440x900, no page-level vertical scroll, no page errors.
- `npm run smoke:web-ui-real-dsl`: external_blocked because real runner timed out after 180s; UI still showed structured `runner_timeout`, no `empty_response`.
- `npm run smoke:web-ui-l1-dedup`: passed.
- `npm run smoke:web-ui-empty-response-regression`: passed.

### 8. 截图路径
- `F:\字节比赛\最终程序\reporting\web-ui-empty-response-fixed.png`
- `F:\字节比赛\最终程序\reporting\web-ui-real-dsl-structured-error.png`
- `F:\字节比赛\最终程序\reporting\web-ui-real-dsl-fixed-main.png`
- `F:\字节比赛\最终程序\reporting\web-ui-real-dsl-fixed-report.png`

### 9. 安全检查
- api key leakage: false
- authorization leakage: false
- api_config returned: false
- Agent Plan: not entered
- Agent Handoff: not entered
- Code execution: not entered by DSL workflow
- scanned paths: reporting plus latest run artifacts for `RUN-20260607-172515-Z7RC0`, `RUN-20260607-172836-76GHY`, `RUN-20260607-173008-VTP95`, `RUN-20260607-173155-TE4WP`

### 10. 最终状态
pass

### 11. 是否建议返工
不建议返工。后端 empty 500 路径已补成结构化 JSON；真实 runner 外部超时属于独立外部阻塞，当前 UI 已能正确显示结构化错误。
