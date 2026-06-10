## DSL Clarification Strategy Restore 完成报告

### 1. 最近 DSL 改动定位

* checked commits: `git log --oneline -12`，重点看到 `6ae5416 fix: support multi-dimensional clarification refinement loop` 和最新 `4cef134 feat: enable real agent execution from workbench`。
* checked files: `server/services/skillOrchestrator.js`、`server/server.test.js`、`src/App.test.jsx`，并按要求只读搜索了 `clarification/question/refinement/dimension/P1/P2/P3/继续丰富/开始施工/questionCount/questions`。
* p1/p2/p3 meaning: 当前代码没有显式 P1/P2/P3 命名。根据最近 DSL diff、常量和测试推断：P3 是初始强制 5-8 个多维问题、至少覆盖多个 dimension，继续丰富一次问 2 个问题；P1 是初始核心澄清；P2 是点击“继续丰富需求”后的补充澄清。

### 2. 根因

* why strategy became p3: `skillOrchestrator.js` 中 `INITIAL_MIN_QUESTIONS=5`、`INITIAL_MAX_QUESTIONS=8`、`REFINEMENT_QUESTIONS=2`，`normalizeClarificationQuestionList` 会补齐并截取多问题组，`resolveClarificationProgress` 也把回答一次问题组视为完成。
* why it was wrong: 对“统计浏览量放在文章最后”这类需求，系统会过早展开目标用户、多个方向和泛化 PM 模板问题，不符合 P1/P2 的克制澄清节奏。

### 3. 修改文件

* `server/services/skillOrchestrator.js`
* `server/server.test.js`
* `src/App.test.jsx`
* `reporting/dsl_clarification_strategy_restore_report.md`
* `reporting/dsl_clarification_strategy_restore_summary.json`

### 4. 修复内容

* 初始澄清数量改为每轮 1 个问题。
* 初始核心澄清需要 2 次回答后才进入“继续丰富需求 / 开始施工”CTA。
* 继续丰富每轮只问 1 个补充问题，删除 P2 第二个问题。
* 浏览量场景优先按固定 P1/P2 顺序提问：先确认累计总浏览量 vs 今日/实时等指标，再确认去重规则。
* 点击继续丰富后优先问异常兜底问题，不进入 5-8 个多维问题组。
* prompt 提示从“multiple user-answerable questions”改为“one concise user-answerable question”。

### 5. 保留内容

* Enter 发送、Shift+Enter 换行相关测试仍保留并通过。
* 空态 0 分修复仍保留。
* report CTA 映射未修改。
* displayScore 阶段式规则未回退。
* 开始施工仍跳转设计规划，不触发 Agent。
* 短回答在已有澄清上下文中仍继续进入 DSL turn，不被 greeting gate 拦截。

### 6. 测试结果

* `npm test`: passed，14 files / 148 tests。
* `npm run test:server`: passed，8 files / 88 tests。
* `npm run build`: passed，Vite build completed。

### 7. 禁止项检查

* `npm run dev`: 未执行。
* `npm run verify`: 未执行。
* `npm run smoke`: 未执行。
* `taskkill`: 未执行。
* agent(2): 未修改。
* `server/services/agent2Adapter.js`: 未修改。
* `server/services/agentExecutionService.js`: 未修改。
* `skills/**`: 未修改。
* `vite.config.js`: 未修改。
* `scripts/run-web-dev.mjs`: 未修改。
* 真实 Agent 执行: 未进入。
* 真实业务 repo 写入: 未执行。

### 8. 是否建议返工

不建议返工。当前修改范围集中在 DSL 澄清策略与测试，已按 P1 + P2 精简版恢复，并保留现有 Agent、Skills、性能和 MockMap 相关工作。
