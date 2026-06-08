## Task 12.1 Real PM→DSL Runner Web Integration 完成报告

### 1. 修改文件

- `package.json`
- `vite.config.js`
- `server/index.js`
- `server/routes/dslRuns.js`
- `server/routes/artifacts.js`
- `server/services/runnerService.js`
- `server/services/artifactService.js`
- `server/services/redactionService.js`
- `server/services/runStore.js`
- `server/server.test.js`
- `src/api/dslClient.js`
- `src/adapters/dslArtifactAdapter.js`
- `src/adapters/dslArtifactAdapter.test.js`
- `src/components/DSLWorkbench.jsx`
- `src/components/ClarificationChat.jsx`
- `src/components/DSLStatusConsole.jsx`
- `src/components/RequirementReportModal.jsx`
- `src/components/ReportQualityPanel.jsx`
- `src/data/dslWorkbenchData.js`
- `src/App.test.jsx`
- `src/styles.css`
- `scripts/smoke.mjs`
- `scripts/verify-render.mjs`
- `scripts/smoke-real-dsl.mjs`

### 2. 后端实现

- API endpoints: `GET /api/health`, `POST /api/dsl/runs`, `GET /api/dsl/runs/:runId/artifacts`, `GET /api/artifacts/:runId/artifacts`
- runner invocation: Node `child_process.spawn` 调用 `python -m runtime.pm_dsl_runner`，cwd 为 `F:\dsl-v2`，设置 `PYTHONPATH=F:\dsl-v2;F:\dsl-v2\core`
- timeout: 后端单次 runner timeout 为 180 秒；超时写入 `error.json` 并返回 `runner_timeout`
- artifact reading: 读取 runner batch root 和 `single_case` case dir 下的标准 artifacts，缺失文件返回 `{ "exists": false }`
- redaction: 对 stdout / stderr / artifacts / error details 做递归 redaction，敏感键名和值均遮罩为 `***REDACTED***`
- `maxRounds`: 当前 runner CLI 不支持 `--max-rounds`，后端不修改 runner，内部忽略该字段并在 response runner metadata 标记 `maxRoundsIgnored`

### 3. 前端实现

- 发送回答: 点击 `发送回答` 后追加 PM 消息，设置 run 状态为 `running`，调用 `POST /api/dsl/runs`
- run 状态: 右侧显示 `Run`、`状态`、`输出目录`、`真实 DSL enabled`
- DSL 状态控制台: completion / readiness / risks 从 artifacts adapter 映射
- 推荐澄清问题: EVPI `ranked_questions[0]` 优先；无 EVPI 时回退到本地 6/8/10/7 间隔策略
- 需求报告 modal: 使用 `12_final_dsl.json`、`09_scoring.json`、`10_evpi_clarification.json`、`13_case_summary.md` 映射人类可读报告
- error state: runner failed / timeout 会显示失败状态和 error panel，不崩溃

### 4. Artifact 映射

- DSL completion: 优先读取 `09_scoring.json` 中的 score；缺失时从 final DSL 估算并标记 source
- readiness: 读取 `ready_for_agent` / `handoff_decision` / `can_handoff_to_agent` / `coverage_source_type`，缺失时固定 fallback 为 `ready_for_agent=false` 与 `handoff_decision=clarify_first`
- risks: 从 `06_risk_activation.json`、`09_scoring.json`、`10_evpi_clarification.json` 提取并规范化 priority/key/reason/category/impact
- EVPI question: 优先读取 `10_evpi_clarification.json ranked_questions[0]`，UI 显示 `来源：EVPI-lite`
- human-readable report: 从 final DSL、scoring、EVPI 和 case summary 映射摘要、范围、风险、不能 handoff 原因和下一步动作；不完整字段标记 fallback

### 5. Mock 测试

- command: `npm test`
- result: 4 个测试文件通过，19 个测试通过
- command: `npm run test:server`
- result: 2 个测试文件通过，6 个测试通过

### 6. 真实 DSL smoke

- PM input: `登录失败提示太模糊，希望用户知道下一步怎么做。`
- run id: `RUN-20260607-160504-JAHR9`
- output dir: `runs\RUN-20260607-160504-JAHR9`
- status: `passed`
- artifacts generated: `00_input.json`, `01_code_context_packet.json`, `02_prompt_messages.json`, `03_api_request.json`, `04_api_response_raw.json`, `05_dsl_draft.json`, `06_risk_activation.json`, `07_router_schema_activation.json`, `08_gap_vector.json`, `09_scoring.json`, `10_evpi_clarification.json`, `11_pm_turns.json`, `12_final_dsl.json`, `13_case_summary.md`, `summary.json`, `summary.md`
- right panel updated: 是，显示真实 run id、passed、artifact readiness、risks、EVPI question
- report modal updated: 是，显示真实 run id 和 artifacts 映射报告
- failure reason if any: 无

### 7. 单屏布局

- 1920x1080: `hasVerticalPageScroll=false`
- 1440x900: `hasVerticalPageScroll=false`
- hasVerticalPageScroll: mock render 验证和真实 smoke 均为 false
- modal scroll: 真实 smoke modal 为 `hasVerticalPageScroll=false`

### 8. 安全检查

- api key leakage: false，源码 / scripts / reporting / 最新真实 run artifacts 窄规则扫描未命中真实 key
- Authorization leakage: false
- .env committed: false，未发现 `.env*`
- real API config returned to frontend: false，health 只返回 `apiConfigExists`
- runs committed: false，本轮只生成本地 `runs\...` 输出目录，不作为提交产物
- real API called: true，真实 smoke passed

### 9. 保持边界

- Agent Plan: false
- Agent Handoff: false
- code execution: false
- PostEval: false
- 本次仅做到 PM / PRD → RequirementDSL draft / clarification-ready DSL

### 10. 已知限制

- runner CLI 当前不支持 `--max-rounds`，后端不修改 runner，忽略前端请求中的 `maxRounds`
- 当前每次发送回答都会新建完整 run；未实现 streaming / incremental runner
- Artifacts 入口为轻量 toast / API，不是完整 Explorer
- `runs/` 是真实本地输出目录，需继续保持不提交

### 11. 是否建议返工

no
