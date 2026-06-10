## Mock Mapping Replacement 完成报告

### 1. Mock 审计矩阵

| mock 位置 | 当前用途 | 当前 mock 数据 | 应映射到的真实来源 | 替换策略 | 是否本轮替换 | 风险 |
| ------- | ---- | ---------- | --------- | ---- | ------ | -- |
| `src/components/ReviewCheckWorkbench.jsx` | 审计页变更文件 fallback | `src/components/LoginForm.jsx`、`ErrorMessage.jsx`、`App.test.jsx` 固定文件 | persistence review items 或 Agent dry-run `review.changedFiles` | 无真实数据时显示空态，不再注入固定文件 | 是 | 低 |
| `src/components/PRWorkbench.jsx` | PR 页草稿 fallback | `Agent dry-run PR draft pending`、`Dry-run artifacts reviewed` | persistence PR draft 或 Agent dry-run `prDraft` | 无真实草稿时显示空 PR 状态 | 是 | 低 |
| `src/data/agentWorkflowData.js` | 共享 fallback 数据 | `fallbackAgentReview`、`fallbackPrDraft` | 组件从 props / API 映射真实数据 | 删除无人使用 fallback export | 是 | 低 |
| `src/data/mockData.js` | 监控台首页示例数据 | runs、metrics、timeline、sample task | persistence / real run history | 本轮未改，监控台不属于低冲突 Workbench 切片 | 否 | 中 |
| `src/data/workspaceProjects.js` | 项目选择兜底 | sample project / fallback sample project | persistence projects repository | 本轮未改，`WorkspaceShell` 正在并行修改 | 否 | 中 |
| `src/adapters/dslArtifactAdapter.js` | DSL 报告 fallback | 本地 mock 报告、fallback risks | DSL run artifacts / core output | 本轮未改，DSL flow 正在并行修改 | 否 | 中 |
| `src/components/RequirementReportModal.jsx` | 导出 toast | `导出 JSON（mock）`、`导出 Markdown（mock）` | 真实导出 API / artifact path | 本轮未改，需求报告结构不在低冲突切片 | 否 | 中 |
| `server/services/agentExecutionService.js` | Agent dry-run 默认输出 | LoginForm/ErrorMessage、默认 checklist | Agent dry-run adapter real result | 本轮未改，用户要求先报告再碰 agent execution | 否 | 高 |
| `server/services/agent2Adapter.js` | agent(2) adapter fixture | Workbench fixture / default checklist | agent(2) adapter real dry-run output | 本轮未改，明确禁止修改 `agent(2)/` 和 agent2 adapter | 否 | 高 |
| smoke / test files | 测试输入和夹具 | mock env、fixture text | 保留为测试夹具 | 只更新与本轮断言相关测试 | 部分 | 低 |

### 2. 已替换 mock

- Review 页面不再从 `fallbackAgentReview` 或 `defaultAuditChangedFiles` 注入固定审计文件。
- Review 页面现在优先使用持久化 `reviewItems`，其次使用 `agentWorkflow.review.changedFiles`，没有真实数据时显示空态。
- PR 页面不再使用 `fallbackPrDraft`。
- PR 页面现在优先使用持久化 PR draft，找不到时使用 `agentWorkflow.prDraft`，仍没有真实数据时显示空草稿。
- 删除 `src/data/agentWorkflowData.js` 中无人使用的 `fallbackAgentReview` / `fallbackPrDraft` export。

### 3. 保留的 test fixtures

- `src/App.test.jsx` 内用于 agent dry-run 流程的 `LoginForm.jsx`、`Dry-run artifacts reviewed` 是测试夹具，保留。
- `src/components/frontendPersistence.test.jsx` 新增真实映射/空态测试夹具，不流入生产 UI。
- smoke 脚本中的 `DSL_RUNNER_MODE=mock`、`SKILL_MODEL_MODE=mock` 属于测试环境构造，按任务要求保留。

### 4. 新真实数据映射

* Project: 继续由 persistence project / activeProject 提供，本轮未改项目选择链路。
* DSL: 本轮未改，避免触碰并行 DSL 单问题流。
* Clarification: 本轮未改，避免触碰并行 DSL 澄清交互。
* Design: 已有 design plan API / agent dry-run plan 映射，本轮未改。
* Review: `listReviewItems(runId)` 优先；无持久化数据时使用 `agentWorkflow.review.changedFiles`；无数据时显示空态。
* PR: `getPrDraft(requirementId)` 优先；`pr_draft_not_found` 时使用 `agentWorkflow.prDraft`；无数据时显示空草稿。
* Preview: 继续使用 preview API status/start，本轮未改。

### 5. 修改文件

- `src/components/ReviewCheckWorkbench.jsx`
- `src/components/PRWorkbench.jsx`
- `src/data/agentWorkflowData.js`
- `src/components/frontendPersistence.test.jsx`
- `src/App.test.jsx`
- `reporting/mock_mapping_replacement_report.md`
- `reporting/mock_mapping_replacement_summary.json`

### 6. 冲突规避

* touched performance files: false
* touched DSL clarification flow files: false
* touched agent2 files: false
* stopped due conflict: false
* retained due conflict: `server/services/agentExecutionService.js`、`server/services/agent2Adapter.js` 中的 agent dry-run fixture 未改。

### 7. 测试结果

* targeted frontend persistence test: passed (`npm test -- src/components/frontendPersistence.test.jsx`)
* targeted App preview assertion: passed (`npm test -- src/App.test.jsx -t "keeps the created project localPath"`)
* npm test: failed, 129 passed / 9 failed. Remaining failures are in DSL input gate / clarification flow tests.
* test:server: failed, 81 passed / 1 failed. Remaining failure is `does not gate a short PM answer when it is replying to an active clarification question`.
* build: passed (`npm run build`)
* skipped commands and reason: `npm run dev`、`npm run verify`、`npm run smoke`、`taskkill` were explicitly forbidden by task.

### 8. 安全检查

* api key leakage: false for this task's changed production files; repo-wide scan only found redaction tests and known config path strings.
* local config committed: false
* local db committed: false
* runs committed: false
* node_modules committed: false
* dist committed: false
* real repo write performed: false

### 9. Git / Push

* commit: not created, because allowed regression suites still have unrelated DSL failures and the worktree contains parallel-task changes.
* pushed: false
* branch: main
