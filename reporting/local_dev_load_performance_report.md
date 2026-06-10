## Local Dev Load Performance Fix 完成报告

### 1. 慢加载判断

* possible root cause:
  * `http://127.0.0.1:9999/` HTML 响应约 112ms，主要慢点不在根 HTML。
  * Vite dev server 原配置没有显式忽略 `agent(1)/`、`agent(2)/`、`runs/`、`reporting/`、`data/`、`dist/` 等大目录，容易产生 watch 扫描和文件变更噪声。
  * 首屏模块图包含 Workbench 多个页面模块；尝试 lazy 拆分后现有同步测试不兼容，本轮未保留 lazy 改动，避免扩大变更。
  * 审阅 preview 和 Agent readiness 当前不是 DSL 首屏主动触发，未发现需要重启后端才能修复的轮询问题。
* 9999 process killed: false
* 8787 process killed: false
* dev server restarted: false

### 2. 修改文件

* `vite.config.js`
* `src/main.jsx`
* `src/components/AppShell.jsx`
* `src/components/WorkspaceShell.jsx`
* `src/api/performance.js`
* `src/api/persistenceClient.js`
* `src/api/dslClient.js`
* `src/api/agentClient.js`
* `src/api/previewClient.js`
* `reporting/local_dev_load_performance_report.md`
* `reporting/local_dev_load_performance_summary.json`

### 3. 性能修复

* watch ignored dirs:
  * `**/agent(1)/**`
  * `**/agent(2)/**`
  * `**/runs/**`
  * `**/reporting/**`
  * `**/data/**`
  * `**/dist/**`
  * `**/node_modules/**`
* lazy loaded pages:
  * none retained; attempted for Workbench pages, reverted because existing tests synchronously assert mounted pages.
* reduced initial API calls:
  * no behavior-changing API removal in this hot fix.
  * added development-only timing for project load and active requirement load to identify slow first-screen data paths.
* disabled unnecessary polling:
  * no new polling added.
  * added development-only slow API logging, one log per method/path over 800ms, to catch failed or repeated slow calls without printing payloads.
* preview iframe deferred:
  * verified it remains scoped to the review page mount; no DSL first-screen preview start was added.
* agent readiness deferred:
  * verified readiness remains user-action driven in design planning; no DSL first-screen readiness polling was added.
* warmup files:
  * `./src/main.jsx`
  * `./src/components/WorkspaceShell.jsx`
  * `./src/components/DSLWorkbench.jsx`
  * `./src/components/ClarificationChat.jsx`
  * `./src/components/DSLStatusConsole.jsx`

### 4. 测试结果

* npm test: failed
  * 128 passed, 10 failed.
  * Remaining failures are in existing DSL / review / PR / server behavior tests, not caused by the final retained Vite watch/warmup or timing changes.
* npm run build: passed
  * Built `dist/` locally; not staged or committed.
* skipped commands and reason:
  * `npm run dev`: forbidden by task, would restart/alter current dev process.
  * `npm run verify`: forbidden by task.
  * `npm run smoke`: forbidden by task.
  * `npm run test:server`: skipped because `npm test` already ran server tests and reported an existing server failure.
  * `taskkill`: forbidden by task.

### 5. 是否需要用户手动重启

* requires restart: true
* reason:
  * Client-side timing/API logging can HMR into the current frontend.
  * `vite.config.js` changes for `server.watch.ignored` and `server.warmup.clientFiles` require the user to manually restart Vite later to fully apply. Current process was not restarted.

### 6. 安全检查

* api key leakage: not detected in this task's modified files.
* local config committed: false
* local db committed: false
* runs committed: false
* node_modules committed: false
* dist committed: false
* real repo write performed: false

### 7. Git / Push

* commit: false
* pushed: false
* branch: main
* reason: `npm test` is not passing, so no local commit or push was performed.

