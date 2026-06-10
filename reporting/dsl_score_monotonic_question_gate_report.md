## DSL Score Monotonic Question Gate 完成报告

### 1. 根因

* why score jumped to 45: 前端初始需求、持久化 fallback、artifact adapter 都存在阶段分兜底或低分上抬逻辑；右侧状态控制台 running 时还会用默认 72 再夹到高分段。
* affected states: empty、submitted/running、input_gated、skill_turn、clarification_complete。
* affected files: `src/components/DSLWorkbench.jsx`、`src/components/DSLStatusConsole.jsx`、`src/adapters/dslArtifactAdapter.js`、`server/services/skillOrchestrator.js`。

### 2. 评分规则

* empty: 0 分，source 为 not_started。
* submitted/running: 没有稳定分时显示 0；已有稳定分时保持 previous displayScore。
* input_gated: 0 分，不把输入门禁解释为 DSL 质量。
* valid draft: 使用 DSL/artifact/scoring rawScore 映射，未 ready 时不抬到 45。
* monotonic displayScore: 前端同一链路合并 uiState 时使用 `Math.max(previousStableScore, nextDisplayScore)`。
* rawScore vs displayScore: rawScore 保留真实计算值；displayScore 只用于 UI 展示，可单调不降。

### 3. DSL 计算维度

* coverage fields: scope、behavior、data、permission、state_error、acceptance_oracle、copy_ui。
* missing fields: 后端继续通过 DSL core pending items 和澄清问题补齐。
* risk penalty: DSL core rawScore 仍根据风险与缺失字段扣分。
* answered question bonus: skill orchestration 返回 answeredQuestionCount 和 coveredDimensions，用于 readiness/CTA gate。
* readiness gate: answeredQuestionCount >= 5 且 coveredDimensions >= 4 后才允许 clarification_complete。

### 4. 提问策略

* minimum answered questions before start: 5。
* required dimensions: 至少 4 个维度。
* example questions: 浏览量需求优先覆盖统计口径、去重、未登录归并、失败状态、验收证据。
* blocked generic questions: 通用 fallback 不再默认询问目标用户，除非需求文本显式涉及用户群体、角色或受众。

### 5. CTA 规则

* continue refine: 未满足 gate 时继续问未覆盖方向。
* start construction: 只在 clarification_complete 消息上显示。
* start construction gate: 前端也校验 answeredQuestionCount >= 5 且 coveredDimensions >= 4。
* agent triggered: false，点击开始施工只进入设计规划页，不调用 `/api/agent/run`。

### 6. 未触碰范围

* agent2: 未修改、未 stage。
* skills: 未修改。
* performance: 未修改。
* mock mapping: 未修改、未 stage 现有无关 mock 改动。
* review/pr: 未修改 ReviewCheckWorkbench / PRWorkbench。

### 7. 测试结果

* npm test: passed，14 files / 152 tests。
* test:server: passed，8 files / 91 tests。
* build: passed，Vite production build completed。

### 8. 安全检查

* api key leakage: 未发现本任务新增真实密钥；宽松扫描仅命中既有测试 fixture / 文档引用。
* local config committed: false。
* local db committed: false。
* runs committed: false。
* node_modules committed: false。
* dist committed: false。
* real repo write performed: false。

### 9. Git / Push

* commit: fix: compute monotonic DSL score and gate start by questions
* pushed: true
* branch: main

### 10. 是否建议返工

不建议返工。实现已覆盖 running/input_gated 不显示 45、低 rawScore 不上抬、displayScore 单调、5 问 4 维 gate、开始施工不触发 Agent。
