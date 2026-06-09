## Task 13.5-D Legacy Runner Callsite Inventory

### 1. 谁在找 `pm_dsl_runner.py`

修复前调用点在 `server/services/runnerService.js`，由 `git show 787b86e^:server/services/runnerService.js` 复核：

- `getHealth()` 检查 `path.join(merged.dslRuntimeRoot, "runtime", "pm_dsl_runner.py")`。
- `createDslRun()` 在同步 DSL run 启动前调用 `getHealth()`。
- `createRunContext()` 在异步完整 artifacts job 启动前调用 `getHealth()`。
- `invokePythonRunner()` 执行 `python -m runtime.pm_dsl_runner`，并把 `cwd` / `PYTHONPATH` 指向 `dslRuntimeRoot`。

当前源码核验：

- `rg -n "pm_dsl_runner" server src scripts e2e package.json` 不再命中后端真实调用链。
- `server/services/runnerService.js` 当前调用 `checkStandaloneArtifactRunner()` 和 `runStandaloneArtifactRunner()`。

### 2. 谁返回 `runner_missing`

修复前返回点：

- `server/services/runnerService.js`
  - `createDslRun()` 在旧 runner 缺失时返回 `runner_missing: pm_dsl_runner.py not found`。
  - `createRunContext()` 在异步完整 artifacts 旧 runner 缺失时返回同样错误。
- `server/routes/dslRuns.js`
  - 旧路由把 `runner_missing` 映射成 HTTP `503`。

当前源码核验：

- 后端完整 artifacts 链路不再返回旧的 `runner_missing: pm_dsl_runner.py not found`。
- 新缺失码为 `standalone_runner_missing`，生成失败码为 `standalone_artifact_failed`。

### 3. UI 的“完整 DSL artifacts”状态来自哪个接口

- UI component: `src/components/DSLStatusConsole.jsx`
  - `artifactStatus` 来自 `runState.artifactStatus`，fallback 为 `formatArtifactStatus(runState.status)`。
- State owner: `src/components/DSLWorkbench.jsx`
  - 启动完整 artifacts: `startDslRun()` -> `POST /api/dsl/runs/start`。
  - 轮询状态: `getDslRun()` -> `GET /api/dsl/runs/:runId`。
  - 错误详情/partial artifacts: `getDslRunArtifacts()` -> `GET /api/dsl/runs/:runId/artifacts`。
- Backend route: `server/routes/dslRuns.js`
  - `/api/dsl/runs/start` -> `startDslRunJob()`。
  - `/api/dsl/runs/:runId` -> `getDslRunJob()`。
  - `/api/dsl/runs/:runId/artifacts` -> `getDslRunArtifacts()`。

### 4. “重试完整 artifacts”按钮调用哪个接口

- UI component: `src/components/DSLStatusConsole.jsx`
  - failed / timeout / cancelled 时显示“重试完整 artifacts”，点击调用 `onRetryRun`。
- Handler: `src/components/DSLWorkbench.jsx`
  - `handleRetryRun()` 调用 `retryDslRun(runState.runId)`。
- API client: `src/api/dslClient.js`
  - `retryDslRun()` 调用 `POST /api/dsl/runs/:runId/retry`。
- Backend route: `server/routes/dslRuns.js`
  - `POST /api/dsl/runs/:runId/retry` -> `retryDslRunJob()` -> `startDslRunJob()`。

### 5. 当前 standalone runner 的入口文件是什么

- Web artifacts adapter:
  - `server/services/standaloneArtifactRunner.js`
- 项目内 reusable E2E runner:
  - `e2e/runner/standalone-e2e.mjs`
- CLI smoke entry:
  - `scripts/smoke-e2e-real.mjs`
  - `scripts/smoke-standalone-artifacts.mjs`
- Supporting modules:
  - `e2e/runner/config-loader.mjs`
  - `e2e/runner/llm-client.mjs`
  - `e2e/context/context-adapter.mjs`
  - `e2e/runner/json-utils.mjs`
  - `e2e/runner/secret-scan.mjs`

### Root Cause

快速澄清已经走 `POST /api/skill/pm-dsl-turn` 的真实模型链路。旧完整 artifacts 链路独立检查并执行 `runtime.pm_dsl_runner`，所以在没有旧 runtime / `pm_dsl_runner.py` 的机器上会提前失败，错误显示为 `runner_missing: pm_dsl_runner.py not found`。

### Required Fix Direction

- 完整 artifacts 真实链路改走项目内 `server/services/standaloneArtifactRunner.js`。
- 不恢复 `F:\dsl-v2` 依赖。
- 不要求用户补 `pm_dsl_runner.py`。
- artifacts 阶段保持 dry-run，只生成 DSL / Context / Report，不进入 Agent 写文件阶段。
