## Task 13.5 Replace Legacy pm_dsl_runner with Standalone E2E Artifact Runner 完成报告

### 1. 根因

- 旧链路在 `server/services/runnerService.js` 中把 `e2e/runtime/pm_dsl_runner.py` 当作完整 DSL artifacts 的必需 runner。
- `getHealth()`、`createDslRun()`、async job 执行路径都会因为缺少 `pm_dsl_runner.py` 返回旧错误。
- UI 的“完整 DSL artifacts”状态来自 `/api/dsl/runs/start` 和 `GET /api/dsl/runs/:runId` 的 runState；“重试完整 artifacts”调用 `POST /api/dsl/runs/:runId/retry`。

### 2. 修改文件

- `server/services/standaloneArtifactRunner.js`
- `server/services/runnerService.js`
- `server/routes/dslRuns.js`
- `e2e/runner/config-loader.mjs`
- `src/components/DSLStatusConsole.jsx`
- `src/components/DSLWorkbench.jsx`
- `src/App.test.jsx`
- `src/api/dslClient.test.js`
- `server/server.test.js`
- `scripts/verify-render.mjs`
- `scripts/smoke-standalone-artifacts.mjs`
- `package.json`
- `reporting/legacy_runner_callsite_inventory.md`

### 3. 新链路

- Web UI / server -> `standaloneArtifactRunner` -> project-local `e2e/runner` reusable modules -> `runs/<runId>` artifacts.
- 不再调用 `python -m runtime.pm_dsl_runner`。
- 不再把 `pm_dsl_runner.py` 当作 required runner。
- standalone artifacts 阶段只生成 DSL / Context / Report artifacts，不进入 Agent Handoff，不执行真实 repo 写入。

### 4. 结果行为

- 成功时返回 `artifactStatus: "done"`。
- 失败时返回 `standalone_artifact_failed` 或 standalone 专用错误码，不再显示 `runner_missing: pm_dsl_runner.py not found`。
- UI 支持 `idle / running / done / failed` artifacts 状态。
- retry 按钮继续调用 `/api/dsl/runs/:runId/retry`，测试覆盖 retry 后显示完整 artifacts done。

### 5. 页面级真实验证

- `npm run smoke:standalone-artifacts` 通过。
- 前端地址：`http://127.0.0.1:9999`
- 后端地址：`http://127.0.0.1:8787`
- 快速澄清：done
- 完整 DSL artifacts：done
- runId：`RUN-20260609-115233-EMSP2`
- 输出目录可见：true
- 来源可见：Real model / doubao_ark
- mockUsed：false
- 页面级旧 runner 文本：false
- 页面级纵向滚动：false
- console errors：0

说明：真实页面 smoke 中初始完整 artifacts 已直接成功，因此页面没有出现失败态 retry 控件；retry 交互由 `src/App.test.jsx` 覆盖。

### 6. 测试方式

- `npm test`
- `npm run test:server`
- `npm run build`
- `npm run smoke`
- `node scripts\verify-render.mjs`
- `npm run check:standalone`
- `npm run smoke:e2e-real:dry-run`
- `npm run smoke:standalone-artifacts`
- Browser in-app check: page loaded at `http://127.0.0.1:9999`, no console errors, no Vite overlay, no old runner text.

### 7. 测试结果

- `npm test`: passed, 75 tests.
- `npm run test:server`: passed, 45 tests.
- `npm run build`: passed.
- `npm run smoke`: passed.
- `node scripts\verify-render.mjs`: passed, 1920x1080 and 1440x900 no page vertical scroll.
- `npm run check:standalone`: passed, `requiresExternalDslV2=false`.
- `npm run smoke:e2e-real:dry-run`: passed, `realLlmCalls=3`, `mockLlmUsed=false`, `realWritePerformed=false`.
- `npm run smoke:standalone-artifacts`: passed, artifacts done, `mockUsed=false`.

### 8. 截图路径

- `F:\字节比赛\最终程序\reporting\standalone-artifacts-done.png`
- `F:\字节比赛\最终程序\reporting\standalone-artifacts-retry.png`

### 9. 安全检查

- API key leakage: false
- `configs/api_config.local.json` staged: false
- `*.local.json` staged: false
- `.env` staged: false
- `runs/` staged: false
- `node_modules/` staged: false
- `dist/` staged: false
- mock LLM pretending success: false
- real target repo write during artifacts stage: false
- Agent Handoff entered: false
- code execution entered: false
- hunter / auto-reply / A3B touched: false
- force push: false

### 10. 是否建议返工

不建议返工。旧 runner 依赖已从完整 DSL artifacts 主链路移除，standalone runner 真实页面验证通过。
