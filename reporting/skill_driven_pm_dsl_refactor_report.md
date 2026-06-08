## Task 12.2 Skill-driven PM→DSL Orchestration Refactor 完成报告

### 1. 根因

原 DSL Workbench 的 PM-facing 回复仍容易被本地 EVPI/raw question 模板主导，导致用户看到的是工程化追问，而不是由 Skill 编排后的自然 PM 澄清话术。EVPI 适合作为后台信号，但不应直接成为 PM 对话文本。

### 2. 架构调整

- 新增 `/api/skill/pm-dsl-turn`，PM 输入先进入 Skill-driven 编排，再启动原 runner 后台更新 artifacts/status。
- 新增 skill prompt loader，读取 `F:\dsl-v2\skills\prd_to_dsl\skill.md`、`F:\dsl-v2\skills\clarification\skill.md`、`F:\dsl-v2\skills\code_context\skill.md`。
- 新增 skill orchestrator，默认使用 mock model；如配置 OpenAI-compatible endpoint，可走模型生成。
- UI 展示 `assistant_message`，EVPI raw question 只保留为后台信号，不作为 PM-facing 文案。
- 安全边界强制保持：`ready_for_agent=false`、`can_handoff_to_agent=false`、`handoff_decision=clarify_first`。
- runner 仍可后台执行并更新右侧状态、报告 modal 和 artifacts，但不进入 Agent Plan / Handoff / 代码执行。

### 3. 修改文件

- `server/prompts/pm_to_dsl_skill_orchestration.md`
- `server/services/skillPromptLoader.js`
- `server/services/skillOrchestrator.js`
- `server/routes/skill.js`
- `server/index.js`
- `server/server.test.js`
- `src/api/dslClient.js`
- `src/components/DSLWorkbench.jsx`
- `src/App.test.jsx`
- `scripts/smoke-skill-driven-l1.mjs`
- `scripts/smoke-l1-dedup.mjs`
- `package.json`
- `reporting/skill_driven_pm_dsl_refactor_report.md`
- `reporting/skill_driven_pm_dsl_refactor_summary.json`

### 4. L1 真实 UI 结果

- 新增 L1 smoke：`npm run smoke:web-ui-skill-driven-l1`
- 结果：passed
- runId：`RUN-20260608-074350-2BSCN`
- PM-facing 回复：显示自然系统澄清话术，包含候选验收口径、空正文/NaN 防护、每分钟 400 字估算确认问题。
- candidate acceptance criteria：true
- raw EVPI question exposed：false
- ready_for_agent：false
- safetyBoundaryVisible：true
- handoff_decision：`clarify_first`
- report modal opened：true
- pageVerticalScroll：false

### 5. 测试方式

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
- 安全扫描：`rg -n "sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._~+/=-]+|api[_-]?key\s*[:=]|authorization\s*[:=]" reporting runs --glob "!node_modules/**"`

### 6. 测试结果

- `npm test`：passed，6 files / 46 tests
- `npm run test:server`：passed，2 files / 21 tests
- `npm run build`：passed
- `npm run smoke`：passed
- `node scripts\verify-render.mjs`：passed，1920x1080 与 1440x900 均无页面级纵向滚动；modal 打开后无页面级纵向滚动
- `npm run smoke:web-ui-real-dsl`：passed，runnerStatus `passed`，report modal opened
- `npm run smoke:web-ui-l1-dedup`：passed，两轮 skill 自然回复，未暴露重复 EVPI 原始问题
- `npm run smoke:web-ui-empty-response-regression`：passed
- `npm run smoke:web-ui-runner-timeout`：passed
- `npm run smoke:web-ui-runner-cancel`：passed
- `npm run smoke:web-ui-skill-driven-l1`：passed
- 安全扫描：passed，`reporting` / `runs` 未发现凭据或鉴权材料泄漏

### 7. 截图路径

- `F:\字节比赛\最终程序\reporting\web-ui-skill-driven-l1-main.png`
- `F:\字节比赛\最终程序\reporting\web-ui-skill-driven-l1-report.png`
- `F:\字节比赛\最终程序\reporting\web-ui-l1-dedup-after-answer.png`
- `F:\字节比赛\最终程序\reporting\web-ui-l1-dedup-report.png`
- `F:\字节比赛\最终程序\reporting\real-dsl-workbench-result-1920x1080.png`
- `F:\字节比赛\最终程序\reporting\real-dsl-workbench-result-1440x900.png`
- `F:\字节比赛\最终程序\reporting\real-dsl-report-modal-1920x1080.png`
- `F:\字节比赛\最终程序\reporting\real-dsl-report-modal-1440x900.png`

### 8. 安全检查

- secret leakage：false
- real API connected：false，默认 `SKILL_MODEL_MODE=mock`
- real export files：false，未触发真实发布/导出业务链路
- Agent Plan：未进入
- Agent Handoff：未进入
- code execution by agent：未进入
- core/runtime：未修改 `F:\dsl` 或 `F:\dsl-v2`

### 9. 是否建议返工

不建议返工。当前 PM→DSL 对话已经从本地 EVPI/raw template 改为 Skill-driven 编排，安全边界与 runner 回归均通过。后续可单独增强真实模型 endpoint 的集成测试，但不阻塞本任务。
