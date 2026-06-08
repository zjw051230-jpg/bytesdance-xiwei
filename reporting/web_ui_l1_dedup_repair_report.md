## Task 12.1-C L1 Repeated Clarification Dedup Repair Report

### 1. 原始问题
- repeated question: `你希望用什么用户可见现象或测试结果判断这个需求已经完成？`
- PM answer: 用户已回答文章详情页正文下方展示“本文共 XXX 字，预计阅读 X 分钟”，正文为空不展示，页面不报错、不出现 NaN 或 0 分钟。
- why it was wrong: Web 端上一轮只传 PM 消息，系统澄清问题上下文没有保留；真实 EVPI 推荐问题也没有按历史已问/已答进行 normalized key 过滤。

### 2. 根因
- message history: `DSLWorkbench` 旧逻辑只发送 `role === "pm"` 的消息，系统问题与 PM 回答关系丢失。
- question key: 缺少 `acceptance_visible_result` 这类 normalized question key，无法识别同义验收问题。
- EVPI filtering: UI 直接展示真实 artifact 的 `recommendedQuestion`，没有过滤已回答问题。
- UI reply: 成功回复只拼接 `recommendedQuestion.text`，没有在 PM 已回答验收标准后给“已记录”反馈。

### 3. 修改文件
- `src/utils/clarificationDedup.js`
- `src/utils/clarificationDedup.test.js`
- `src/components/DSLWorkbench.jsx`
- `src/components/ClarificationChat.jsx`
- `server/services/runnerService.js`
- `server/server.test.js`
- `src/App.test.jsx`
- `scripts/smoke-l1-dedup.mjs`
- `scripts/smoke-real-dsl.mjs`
- `scripts/verify-render.mjs`
- `package.json`
- `reporting/web_ui_l1_dedup_repair_report.md`
- `reporting/web_ui_l1_dedup_repair_summary.json`

### 4. 修复内容
- normalized question key: 新增 `normalizeQuestionKey()`，将“用户可见现象 / 测试结果 / 验收标准 / 判断完成”等同义问题统一为 `acceptance_visible_result`。
- answered detection: 新增 `isQuestionAnswered()` 与 `buildAnsweredQuestionKeys()`，本次 L1 验收回答可识别为已回答。
- EVPI question filtering: UI 在展示真实 EVPI 推荐问题前过滤已回答 key、同 key 问题和最近系统问题重复项。
- system reply: 第二轮回复明确“已记录你的验收标准”，并提示当前没有新的高优先级澄清问题。
- UI smoke: 新增 `npm run smoke:web-ui-l1-dedup`，从真实 UI 跑两轮 L1 输入并截图。

### 5. 真实 UI L1 两轮测试
- first run id: `RUN-20260607-170103-N3Y9S`
- first system question: `你希望用什么用户可见现象或测试结果判断这个需求已经完成？`
- second run id: `RUN-20260607-170230-AHSAQ`
- PM answer: 用户可见现象、阅读信息展示、空正文不展示、页面不报错、不出现 NaN 或 0 分钟。
- second system reply: 已记录你的验收标准；当前不再重复询问验收标准；当前没有新的高优先级澄清问题。
- repeated question appeared: no
- report modal opened: yes

### 6. 测试命令
- `npm test`
- `npm run test:server`
- `npm run build`
- `npm run smoke`
- `node scripts\verify-render.mjs`
- `npm run smoke:web-ui-real-dsl`
- `npm run smoke:web-ui-l1-dedup`

### 7. 测试结果
- `npm test`: passed, 6 files / 32 tests
- `npm run test:server`: passed, 2 files / 9 tests
- `npm run build`: passed
- `npm run smoke`: passed
- `node scripts\verify-render.mjs`: passed, 1920x1080 与 1440x900 均无页面级纵向滚动
- `npm run smoke:web-ui-real-dsl`: passed, run `RUN-20260607-165924-NWS7E`
- `npm run smoke:web-ui-l1-dedup`: passed, repeatedQuestionAppeared=false

### 8. 截图路径
- `F:\字节比赛\最终程序\reporting\web-ui-l1-dedup-after-answer.png`
- `F:\字节比赛\最终程序\reporting\web-ui-l1-dedup-report.png`

### 9. 安全检查
- api key leakage: false；本轮 artifacts 中 API 字段均为 `***REDACTED***`。
- real API connected: true；真实 UI smoke 使用真实 PM→DSL runner。
- Agent Plan: false；最终 DSL 中 `agent_plan_generated=false`。
- Agent Handoff: false；最终 DSL 中 `agent_handoff_entered=false`。
- Code execution: false；仅 PM→DSL draft，无代码执行阶段。

### 10. 是否建议返工
不建议返工。两轮真实 UI 流程已证明：用户回答验收标准后，第二轮系统不再重复询问同一验收问题。
