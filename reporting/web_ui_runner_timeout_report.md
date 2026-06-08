## Task 12.1-E Runner Timeout Handling 完成报告

### 1. 修改文件
- `server/services/jobStore.js`
- `server/services/artifactService.js`
- `server/services/runnerService.js`
- `server/routes/dslRuns.js`
- `server/index.js`
- `server/server.test.js`
- `src/api/dslClient.js`
- `src/components/DSLWorkbench.jsx`
- `src/components/DSLStatusConsole.jsx`
- `src/styles.css`
- `src/App.test.jsx`
- `package.json`
- `scripts/smoke-runner-timeout.mjs`
- `scripts/smoke-runner-cancel.mjs`
- `reporting/web_ui_runner_timeout_report.md`
- `reporting/web_ui_runner_timeout_summary.json`

### 2. 后端实现
- 新增内存 job store，支持 async start/status/cancel/retry/artifacts 生命周期。
- 新增 `/api/dsl/runs/start`、`/:runId`、`/:runId/artifacts`、`/:runId/cancel`、`/:runId/retry`。
- timeout 保持 `status: "timeout"`，写入 `error.json`，错误码为 `runner_timeout`。
- cancel 保持 `status: "cancelled"`，写入 `cancelled.json`，不伪装 passed。
- retry 使用新的 runId，并保留 original run 信息。
- Windows cancel/timeout 使用进程树清理，避免 runner 子进程残留。
- `/api/dsl/runs/start` 已覆盖结构化 `backend_exception`，避免空响应回归。

### 3. 前端实现
- 发送 PM 回答后改为 async start，然后轮询 run status。
- running 时显示 runId 和取消按钮。
- 长运行提示保留 15s/60s 默认阈值，smoke 可注入短阈值用于快速验证。
- timeout/failed 后显示重试和 partial artifacts 控件。
- cancel 后显示 cancelled 状态和取消提示。
- retry 后启动新 runId，不把旧 timeout/cancel 伪装为成功。
- partial artifacts 以 modal 显示可用产物和 error summary。

### 4. 测试方式
- `npm test`
- `npm run test:server`
- `npm run build`
- `npm run smoke`
- `node scripts\verify-render.mjs`
- `npm run smoke:web-ui-real-dsl`
- `npm run smoke:web-ui-l1-dedup`
- `npm run smoke:web-ui-empty-response-regression`
- `npm run smoke:web-ui-runner-timeout`
- `npm run smoke:web-ui-runner-cancel`

### 5. 测试结果
- `npm test`: passed, 6 files / 41 tests.
- `npm run test:server`: passed, 2 files / 16 tests.
- `npm run build`: passed.
- `npm run smoke`: passed.
- `node scripts\verify-render.mjs`: passed, 1920x1080 and 1440x900, pageVerticalScroll false.
- `npm run smoke:web-ui-real-dsl`: passed, runnerStatus `passed`, runId `RUN-20260608-033933-NWKNC`.
- `npm run smoke:web-ui-l1-dedup`: passed, repeatedQuestionAppeared false.
- `npm run smoke:web-ui-empty-response-regression`: passed, `backend_exception` JSON returned, no empty response.
- `npm run smoke:web-ui-runner-timeout`: passed, runnerStatus `timeout`, runId `RUN-20260608-034431-0G728`.
- `npm run smoke:web-ui-runner-cancel`: passed, runnerStatus `cancelled`, runId `RUN-20260608-034450-ZK2SD`.
- Codex in-app Browser check: passed, workbench visible, send answer visible, persistent generate/regenerate counts 0, pageVerticalScroll false, console errors/warnings 0.

### 6. 截图路径
- `F:\字节比赛\最终程序\reporting\web-ui-runner-running.png`
- `F:\字节比赛\最终程序\reporting\web-ui-runner-long-running.png`
- `F:\字节比赛\最终程序\reporting\web-ui-runner-timeout.png`
- `F:\字节比赛\最终程序\reporting\web-ui-runner-cancelled.png`
- `F:\字节比赛\最终程序\reporting\web-ui-runner-partial-artifacts.png`

### 7. 安全检查
- api key leakage: false. `reporting` and `runs` scan had no secret-pattern matches.
- real API connected: false for timeout/cancel smoke; both use `DSL_RUNNER_MODE=mock`.
- real export files: false. Only test/smoke artifacts under `runs` and `reporting` were created.
- Agent Plan / Agent Handoff / code execution workflow: not entered.
- `F:\dsl` and `F:\dsl-v2` core/runtime: not modified.
- zombie dev processes: no leftover `server/index.js` or Vite `--port 5174` process found after smoke cleanup.
- Browser plugin validation: passed with in-app browser on `http://127.0.0.1:5174`.

### 8. 是否建议返工
- 不建议返工。当前 timeout、cancel、retry、partial artifacts、结构化异常和单屏布局均已有自动测试与 smoke 验证。
