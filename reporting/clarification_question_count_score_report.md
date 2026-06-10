## Task Clarification Question Count and Display Score 完成报告

### 1. 修改文件
- `server/services/skillOrchestrator.js`
- `server/services/standaloneArtifactRunner.js`
- `server/server.test.js`
- `src/adapters/dslArtifactAdapter.js`
- `src/adapters/dslArtifactAdapter.test.js`
- `src/components/ClarificationChat.jsx`
- `src/components/DSLStatusConsole.jsx`
- `src/App.test.jsx`
- `scripts/verify-render.mjs`
- `scripts/smoke-real-skill-l1.mjs`
- `scripts/smoke-real-dsl.mjs`
- `scripts/smoke-l1-dedup.mjs`
- `reporting/clarification_question_count_score_report.md`
- `reporting/clarification_question_count_score_summary.json`

### 2. 追问数量规则
- clarify_first 触发条件：`ready_for_agent=false` 或 `handoff_decision=clarify_first`。
- 最少问题数：2。模型只返回总结、说明或 1 个问题时，后端从自然问题库补齐到 2 个。
- 最多问题数：6。模型返回超过 6 个问题时，只保留前 6 个。
- 问题形式：保留模型问题并补齐问号，fallback 使用 PM 可直接回答的自然问题。
- 聊天区文案：追加 `我还需要确认几个问题：`，随后展示 2-6 条编号问题。
- standalone fallback：clarify_first 默认也返回 2 个 PM 可回答问题。

### 3. displayScore 规则
- `rawScore`：保存真实内部分数，不篡改。
- `displayScore`：仅用于 UI 演示展示，clamp 到 86-94。
- `value`：兼容旧 UI 字段，跟随 `displayScore`。
- 低于 86 的真实分数展示为 86，高于 94 的真实分数展示为 94。
- 报告说明：这是 demo display score clamp，真实 pass/fail 未被改写。

### 4. UI 调整
- 输入框 placeholder 改为：`请输入你的补充回答，系统会继续更新 DSL...`
- 输入框 aria-label 改为：`请输入你的补充回答，系统会继续更新 DSL`
- 右侧圆环使用 `displayScore`，不显示 100，也不低于 86。

### 5. 测试结果
- `npm test`：PASS，10 files / 116 tests。
- `npm run test:server`：PASS，4 files / 69 tests。
- `npm run build`：PASS。
- `npm run smoke`：PASS。
- `npm run verify`：PASS，验证 1920x1080 与 1440x900 均无页面级纵向滚动。
- verify 备注：设计规划页在没有持久化 design plan 时会请求空状态接口并得到预期 404，脚本只将该已知空状态记为 expectedDesignPlanMisses，其他 console/page error 仍会失败。

### 6. 覆盖场景
- 普通需求回复后至少 2 个问题：已覆盖。
- 模型只返回 1 个问题时自动补齐到 2 个：已覆盖。
- 模型返回 10 个问题时截断到 6 个：已覆盖。
- clarify_first 最后一条 assistant message 包含 2-6 个问句：已覆盖。
- displayScore 始终大于 85 且小于 95：已覆盖。
- rawScore 不被篡改：已覆盖。

### 7. 安全检查
- 是否进入 Agent：否。
- 是否真实写 repo：否，仅常规代码、测试脚本和 reporting 文件变更。
- 是否提交 API key：否。
- 是否提交 `api_config.local.json`：否。
- 是否提交 `data/*.sqlite` 或 `*.db`：否。
- 是否提交 `runs/`：否。
- 是否提交 `node_modules/`：否。
- 是否提交 `dist/`：否。

### 8. 是否建议返工
不建议返工。本轮规则已在后端标准化、UI 展示和测试验证链路中闭环。
