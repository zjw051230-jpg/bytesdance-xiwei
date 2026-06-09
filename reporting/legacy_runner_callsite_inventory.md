## Legacy Runner Callsite Inventory

### 1. 谁在找 pm_dsl_runner.py

- `server/services/runnerService.js`
  - `getHealth()` checks `path.join(merged.dslRuntimeRoot, "runtime", "pm_dsl_runner.py")`.
  - `createDslRun()` calls `getHealth()` before starting a synchronous DSL run.
  - `createRunContext()` calls `getHealth()` before starting an async DSL run.
  - `invokePythonRunner()` runs `python -m runtime.pm_dsl_runner`.

### 2. 谁返回 runner_missing

- `server/services/runnerService.js`
  - `createDslRun()` returns `runner_missing` when `getHealth().runnerAvailable` is false.
  - `createRunContext()` returns `runner_missing` when `getHealth().runnerAvailable` is false.
- `server/routes/dslRuns.js`
  - maps `runner_missing` to HTTP `503`.

### 3. UI 的“完整 DSL artifacts”状态来自哪个接口

- UI component: `src/components/DSLStatusConsole.jsx`
  - Uses `runState.status` as the full artifacts status.
- State owner: `src/components/DSLWorkbench.jsx`
  - Starts full artifacts generation through `/api/dsl/runs/start`.
  - Polls status through `GET /api/dsl/runs/:runId`.
  - Reads partial artifacts through `GET /api/dsl/runs/:runId/artifacts`.
- API client: `src/api/dslClient.js`
  - `startDslRun()`
  - `getDslRun()`
  - `getDslRunArtifacts()`

### 4. “重试完整 artifacts”按钮调用哪个接口

- UI component: `src/components/DSLStatusConsole.jsx`
  - Retry button calls `onRetryRun`.
- Handler: `src/components/DSLWorkbench.jsx`
  - `handleRetryRun()` calls `retryDslRun(runState.runId)`.
- API client: `src/api/dslClient.js`
  - `retryDslRun()` calls `POST /api/dsl/runs/:runId/retry`.
- Backend route: `server/routes/dslRuns.js`
  - Routes retry to `retryDslRunJob()`.

### 5. 当前 standalone runner 的入口文件是什么

- CLI smoke entry:
  - `scripts/smoke-e2e-real.mjs`
- Reusable runner module:
  - `e2e/runner/standalone-e2e.mjs`
- Reusable supporting modules:
  - `e2e/runner/config-loader.mjs`
  - `e2e/runner/llm-client.mjs`
  - `e2e/context/context-adapter.mjs`
  - `e2e/runner/json-utils.mjs`
  - `e2e/runner/secret-scan.mjs`

### Root Cause

The quick clarification path already uses the real model through the skill route. The full DSL artifacts path still uses the legacy DSL runner health check and Python invocation, so it fails on machines that do not have `pm_dsl_runner.py` or the old external runtime.

### Required Fix Direction

- Replace the full artifacts real runner path with a project-local standalone artifact runner.
- Keep mock mode only for tests explicitly configured as mock.
- Do not require `F:\dsl-v2`.
- Do not require `pm_dsl_runner.py`.
- Keep full artifacts generation dry-run-only and no target repo writes.
