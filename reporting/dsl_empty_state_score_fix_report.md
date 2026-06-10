## DSL Empty State Score Fix 完成报告

### 1. 根因

* why 58 appeared: `DSLWorkbench` 初始状态直接使用 `fallbackUiState()`，而 `artifactsToUiState({})` 在没有任何 artifact 时也落入 58 分 fallback。
* why fallback_safe_default appeared: `dslArtifactAdapter` 的 readiness/risk/report 映射没有区分“未开始”和“真实失败后的结构化 fallback”；`DSLStatusConsole` 在缺少 readiness 时又补了 `fallback_safe_default`。
* affected components: `src/adapters/dslArtifactAdapter.js`、`src/components/DSLWorkbench.jsx`、`src/components/DSLStatusConsole.jsx`。

### 2. 修改文件

* `src/adapters/dslArtifactAdapter.js`
* `src/components/DSLWorkbench.jsx`
* `src/components/DSLStatusConsole.jsx`
* `src/adapters/dslArtifactAdapter.test.js`
* `src/App.test.jsx`
* `reporting/dsl_empty_state_score_fix_report.md`
* `reporting/dsl_empty_state_score_fix_summary.json`

### 3. 空态规则

* no run: 无有效 runId / 占位 runId 时，且没有 artifact 与真实需求信号，显示 `not_started`。
* no input: 空 requirement、无 PM 输入、无 DSL JSON 时回到 true empty state。
* no artifact: `artifactsToUiState({})` 返回 0 分、无风险、无推荐问题、无 report 的 empty state。
* report CTA: 空态按钮保持 disabled，badge 为未生成，不打开报告。

### 4. 分数规则

* empty state: 0%，不进入 45-65，也不显示 58。
* initial requirement: 有真实 PM 输入但尚未完成澄清时，先显示 45% 初始需求阶段。
* intermediate: 保留既有 artifact/skill score 映射，回答澄清后由真实 uiState 覆盖。
* final: 保留完成态 86-94 的 displayScore clamp。

### 5. fallback_safe_default 边界

* allowed: 已经有真实 artifact / 真实生成上下文但字段不完整时，仍允许安全 fallback 保留结构化报告、风险与建议问题。
* blocked: 初始空页面、无 run、无 PM 输入、无 artifact 时，不再显示 `fallback_safe_default`、默认风险或 Agent 执行判断。

### 6. 测试结果

* npm test: failed。失败集中在当前工作树已有未提交的 `server/services/skillOrchestrator.js` / `server/server.test.js` 改动：`CLARIFICATION_TOTAL_QUESTIONS is not defined`，导致 server 测试批量失败；前端空态定向测试已通过。
* test:server: failed。同样阻塞于 `CLARIFICATION_TOTAL_QUESTIONS is not defined`。
* build: passed。`npm run build` 成功。
* targeted: passed。`npm test -- src/adapters/dslArtifactAdapter.test.js src/App.test.jsx -t "true empty|no DSL artifacts|fallback suggestion|completion score|Enter|single|完成态|sends PM answers|cleans up"` 通过。

### 7. 安全检查

* api key leakage: touched files 未发现 API key。
* local config committed: 未提交；工作区存在 ignored `configs/api_config.local.json`。
* local db committed: 未提交；工作区存在 ignored sqlite 文件。
* runs committed: 未提交；`runs/` 为 ignored。
* node_modules committed: 未提交；`node_modules/` 为 ignored。
* dist committed: 未提交；`dist/` 为 ignored，build 产物未暂存。

### 8. Git / Push

* commit: 未执行，因 `npm test` / `npm run test:server` 未通过。
* pushed: false。
* branch: main。

### 9. 是否建议返工

不建议返工前端空态修复；建议先处理当前未提交的 server 澄清流改动与测试期望冲突，再重新执行全量测试、commit 和 push。
