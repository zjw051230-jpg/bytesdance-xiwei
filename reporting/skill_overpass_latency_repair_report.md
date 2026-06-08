## Task 12.2-B Skill Over-pass and Latency Repair 完成报告

### 1. 原始问题
- over-pass: Skill-driven 回复有时像直接认可需求，缺少关键澄清。
- no-question: L2/L3 这类跨栈或模糊需求没有按 DSL 缺口继续追问。
- latency: PM-facing 回复缺少即时 loading 与快速澄清状态，用户容易误以为要等完整 runner。

### 2. 根因
- prompt: wrapper 缺少“不得直接 pass / 必须给一个关键确认点 / ready 默认 false”的硬规则。
- orchestration: mockSkillModel 只有阅读信息和 generic 两档，L2/L3 会被“文章”关键词误判。
- runner blocking: UI 没有明确拆分 fast skill reply 与完整 artifacts 状态。
- local guardrail: 模型返回 `should_ask=false` 或 `ready=true` 时，后端缺少关键字段缺口修复。

### 3. 修改文件
- `server/prompts/pm_to_dsl_skill_orchestration.md`
- `server/services/skillPromptLoader.js`
- `server/services/skillOrchestrator.js`
- `src/components/DSLWorkbench.jsx`
- `src/components/DSLStatusConsole.jsx`
- `src/styles.css`
- `src/App.test.jsx`
- `server/server.test.js`
- `scripts/smoke-skill-l1-l3.mjs`
- `scripts/smoke-skill-fast-latency.mjs`
- `scripts/smoke-skill-driven-l1.mjs`
- `scripts/smoke-l1-dedup.mjs`
- `scripts/smoke-real-dsl.mjs`
- `scripts/smoke-empty-response-regression.mjs`
- `scripts/smoke-runner-timeout.mjs`
- `scripts/smoke-runner-cancel.mjs`
- `scripts/verify-render.mjs`
- `package.json`

### 4. 修复内容
- prompt guardrails: 增加不说完成、不进入 Agent、缺字段必须问一个关键问题、候选默认值先行的硬规则。
- clarification decision: 后端新增 over-pass repair，模型若过早 `should_ask=false` / `ready=true` 且关键字段缺失，会转为 `fallback_guardrail` 并生成自然确认问题。
- fast skill turn: PM 输入只取最近 12 条，传轻量 signals，并设置 `maxLatencyMs` 默认 12000。
- background runner: UI 先显示 skill 回复，再让 runner artifacts 后台同步。
- latency control: 新增 `slow_response` fallback，fast turn 超时后结构化返回，不让用户一直等。
- UI status split: 右侧新增“快速澄清”和“完整 DSL artifacts”两个状态位。

### 5. L1/L2/L3 结果
- L1 assistant_message: 包含候选验收口径、空正文保护、每分钟 400 字估算候选。
- L1 asked question: true，追问阅读时间估算口径。
- L1 ready_for_agent: false
- L2 assistant_message: 识别后端字段、API 返回、数据兼容和空值/破图风险。
- L2 asked question: true，追问字段名与 URL 校验/空值口径。
- L2 ready_for_agent: false
- L3 assistant_message: 识别推荐规则模糊，并说明 CodeContext 只能辅助，不能替代 PM 决策。
- L3 asked question: true，追问 tag/作者/热门度/发布时间等推荐规则。
- L3 ready_for_agent: false

### 6. 性能结果
- skill reply latency: 25ms（mock fast skill turn）
- runner background: true，runner start 后立即为 `running`
- timeout fallback: true，`mock-hang` 下 109ms 返回 `slow_response`

### 7. 测试命令
- `npm test`
- `npm run test:server`
- `npm run build`
- `npm run smoke`
- `node scripts\verify-render.mjs`
- `npm run smoke:web-ui-real-dsl`
- `npm run smoke:web-ui-l1-dedup`
- `npm run smoke:web-ui-empty-response-regression`
- `npm run smoke:web-ui-runner-timeout`
- `npm run smoke:web-ui-runner-cancel`
- `npm run smoke:web-ui-skill-driven-l1`
- `npm run smoke:web-ui-skill-l1-l3`
- `npm run smoke:skill-fast-latency`

### 8. 测试结果
- `npm test`: passed，6 files / 52 tests
- `npm run test:server`: passed，2 files / 26 tests
- `npm run build`: passed
- `npm run smoke`: passed
- `node scripts\verify-render.mjs`: passed，1920x1080 / 1440x900 无页面级纵向滚动，modal 打开后无页面级纵向滚动
- `npm run smoke:web-ui-real-dsl`: passed
- `npm run smoke:web-ui-l1-dedup`: passed
- `npm run smoke:web-ui-empty-response-regression`: passed
- `npm run smoke:web-ui-runner-timeout`: passed
- `npm run smoke:web-ui-runner-cancel`: passed
- `npm run smoke:web-ui-skill-driven-l1`: passed
- `npm run smoke:web-ui-skill-l1-l3`: passed
- `npm run smoke:skill-fast-latency`: passed

### 9. 截图路径
- `F:\字节比赛\最终程序\reporting\skill-l1-not-pass.png`
- `F:\字节比赛\最终程序\reporting\skill-l2-not-pass.png`
- `F:\字节比赛\最终程序\reporting\skill-l3-not-pass.png`
- `F:\字节比赛\最终程序\reporting\skill-fast-reply-runner-background.png`

### 10. 安全检查
- api key leakage: false
- Agent Plan: false
- Agent Handoff: false
- Code execution: false

### 11. 是否建议返工
不建议返工。当前已修复无脑 pass 与等待 runner 的核心体验问题；后续可继续把真实模型 endpoint 的延迟统计纳入长期监控。
