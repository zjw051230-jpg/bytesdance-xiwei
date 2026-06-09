## Task 13.5-D Standalone Artifact Runner Fix 完成报告

### 1. 根因

- 修复前完整 DSL artifacts 链路在 `server/services/runnerService.js` 中把 `pm_dsl_runner.py` 当作必需 runner。
- 旧链路的 `getHealth()` / `createDslRun()` / async job context 会在缺少旧 runtime 时返回 `runner_missing: pm_dsl_runner.py not found`。
- 快速澄清已走真实 Doubao LLM；失败点是后台完整 artifacts 仍沿用旧 Python runner 检查。

### 2. 修改文件

- `reporting/legacy_runner_callsite_inventory.md`
- `scripts/smoke-standalone-artifacts.mjs`
- `reporting/standalone_artifact_runner_fix_report.md`
- `reporting/standalone_artifact_runner_fix_summary.json`
- `reporting/standalone-artifacts-smoke.json`
- `reporting/standalone-e2e-dry-run-result.json`

说明：`server/services/standaloneArtifactRunner.js`、`server/services/runnerService.js`、`server/routes/dslRuns.js`、UI 状态和 retry 链路已由当前分支历史提交 `787b86e fix: route DSL artifacts through standalone runner` 完成；本轮重新验收并增强 standalone artifacts smoke 的稳定性。

### 3. 新 artifacts 链路

- UI -> `POST /api/dsl/runs/start` -> `startDslRunJob()` -> `runStandaloneArtifactRunner()`。
- Retry -> `POST /api/dsl/runs/:runId/retry` -> `retryDslRunJob()` -> 同一 standalone 链路。
- Runner 读取 `API_CONFIG_PATH` 或 `configs/api_config.local.json`，不要求 `F:\dsl-v2`。
- artifacts 阶段保持 dry-run：生成 DSL / Context / Report 相关 artifacts，不进入 Agent Handoff，不真实写目标 repo。

### 4. UI 结果

- 页面 smoke runId: `RUN-20260609-175125-JIV1D`
- 快速澄清：done
- 完整 DSL artifacts：done
- 输出目录：`runs\RUN-20260609-175125-JIV1D`
- 来源：`Real model · doubao_ark · ep-20260514110933-mzh58`
- 旧错误文案：未出现 `runner_missing` / `pm_dsl_runner.py`
- `mockUsed`: false

### 5. 测试结果

- `npm run test:server`: passed, 57 tests.
- `npm run check:standalone`: passed, `requiresExternalDslV2=false`.
- `npm run smoke:e2e-real:dry-run`: passed, `realLlmCalls=3`, `mockLlmUsed=false`, `realWritePerformed=false`.
- `npm run smoke:standalone-artifacts`: passed, artifacts done, `mockUsed=false`.
- `npm test`: passed, 97 tests.
- `npm run build`: passed.
- `npm run smoke`: passed.
- `node scripts\verify-render.mjs`: failed in optional verification at dev-server UI entry wait (`getByRole('button', { name: '监控台' })` timeout). The standalone artifacts smoke now uses build + static proxy to avoid this Vite dev cold-start issue.

### 6. 截图路径

- `F:\字节比赛\最终程序\reporting\standalone-artifacts-done.png`
- `F:\字节比赛\最终程序\reporting\standalone-artifacts-retry.png`

说明：本次真实页面 artifacts 首次即成功，因此 retry 截图保存的是同一成功态；retry 调用链由 UI/unit tests 覆盖。

### 7. 安全检查

- API key committed: false
- `configs/api_config.local.json` committed: false
- `*.local.json` committed: false
- `.env` / `.env.*` committed: false
- `runs/` committed: false
- `node_modules/` committed: false
- `dist/` committed: false
- mock LLM pretending success: false
- real target repo write during artifacts stage: false
- Agent Handoff entered: false
- hunter / auto-reply / A3B touched: false
- force push: false

### 8. Git 结果

- 本分支历史已有 `787b86e fix: route DSL artifacts through standalone runner`。
- 本轮本地 commit：`fix: route DSL artifacts through standalone runner`，只 stage 本任务允许范围内的文件。
- 未 push。

### 9. 是否建议返工

不建议返工。完整 DSL artifacts 主链路已脱离 `pm_dsl_runner.py` / `F:\dsl-v2` 必需依赖，真实 Doubao 页面 smoke 和服务端/API 测试均通过。
