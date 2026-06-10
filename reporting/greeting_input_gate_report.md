## Task 13.11 Greeting / Too-short Input Misclassification 完成报告

### 1. 修改文件
- `src/utils/inputIntentGate.js`
- `server/services/skillOrchestrator.js`
- `server/services/runnerService.js`
- `server/routes/dslRuns.js`
- `src/components/DSLWorkbench.jsx`
- `src/components/ClarificationChat.jsx`
- `server/server.test.js`
- `src/App.test.jsx`
- `scripts/smoke.mjs`
- `reporting/greeting_input_gate_report.md`
- `reporting/greeting_input_gate_summary.json`

### 2. 新输入门禁规则
- `detectInputIntent(text)` 返回 `greeting` / `too_short` / `ambiguous_requirement` / `requirement_candidate`。
- `greeting`、`too_short`、`ambiguous_requirement` 不进入 DSL 生成。
- 前端命中门禁时只追加自然系统提示，不调用 skill API，不创建 requirement，不启动 artifacts。
- 后端 `runSkillTurn` 在创建 run 目录和加载 prompt 之前门禁，避免调用 Doubao 或写 skill artifacts。
- DSL artifacts runner 入口也做同规则保护，直连 `/api/dsl/runs/start` 时不会创建 run。
- 最新原始 PM 输入优先于历史消息，空输入不会继承上一条“登录失败提示优化”需求标题。

### 3. hello / 你好 / 加一个功能 / 正常需求测试结果
- `hello`: 返回“你好，请输入你想澄清或生成 DSL 的需求。”，不调用 LLM，不生成 DSL，不生成 artifacts。
- `你好`: 返回“你好，请描述你要做的产品需求，我会帮你澄清并生成 DSL。”，不调用 LLM，不生成 DSL，不生成 artifacts。
- `加一个功能`: 返回“你想加什么功能？请补充目标用户、使用场景和期望结果。”，不调用 LLM，不生成 DSL，不生成 artifacts。
- 空输入: 返回“请补充你想澄清或生成 DSL 的需求。”，不继承历史需求。
- 正常需求“登录失败提示太模糊，希望用户知道下一步怎么做”: 保持原有正常 DSL/skill 流程，现有 server/UI/verify 测试通过。

### 4. 是否调用 LLM
- 门禁输入: 否。
- 正常需求: 保持原流程。

### 5. 是否生成 DSL / artifacts
- 门禁输入: 否。
- 正常需求: 保持原流程。

### 6. 测试结果
- `npx vitest --run server/server.test.js src/App.test.jsx`: passed, 72 tests.
- `npm test`: passed, 10 files / 114 tests.
- `npm run test:server`: passed, 4 files / 67 tests.
- `npm run build`: passed.
- `npm run smoke`: passed.
- `npm run verify`: passed; 1920x1080 与 1440x900 均无页面级纵向滚动，console/page errors 为空。

### 7. 安全检查
- Doubao / LLM not called for gated inputs: true.
- RequirementDSL not generated for gated inputs: true.
- artifacts run not created for gated inputs: true.
- Agent entered: false.
- Real repo write: false.
- API key leakage: false.

### 8. Git / Push
- Commit: pending at report generation time.
- Push: pending at report generation time.

### 9. 是否建议返工
- 不建议返工。

