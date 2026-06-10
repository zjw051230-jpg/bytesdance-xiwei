## DSL New Project Bootstrap + P1 Advance Fix 完成报告

### 1. 根因

* why new project showed 74: DSLWorkbench 在 projectId 切换后的首帧仍可能使用上一个项目的 activeRequirement，并且没有立即清空 transient uiState/runState，导致旧项目的 persistent_database score 被短暂映射到新项目。
* why new project entered multi-question P3: skillOrchestrator 仍保留旧的 initial 5-6 问、5 个答案、4 个维度门槛，新项目首次输入后会进入多问题组。
* why existing project P1 got stuck: 前端只在 5 答案 + 4 维度 gate 后才识别 clarification complete；短答虽然可进入后端，但后端进度门槛过高，导致已有项目 P1 回答后不容易出现 CTA。

### 2. 新建项目修复

* empty state: projectId 切换时立即清空 loadedRequirement、messages、uiState、runState 和 input gate。
* score reset: 新项目空态固定回到 displayScore=0 / source=not_started。
* run/requirement isolation: 只复用 projectId 匹配的 activeRequirement；异步返回的 requirement 如果 projectId 不匹配会被丢弃。
* no stale persistent database: 新项目不会把旧 requirement 映射成 persistent_database 状态。
* no P3 multi-question: initial clarification 问题数收敛为 1。

### 3. 已有项目修复

* preserved persisted state: 仍按项目加载已有 requirement 和 clarification history，不清空老项目数据。
* P1 answer handling: 回答已有澄清问题后，后端按 1 个有效回答即可进入 design-planning readiness。
* short answer handling: active requirement / clarification context 下短答不会被本地 input gate 当成新需求拦截。
* advance behavior: 未完成时继续给 1 个 P1/P2 精简问题；完成时返回 clarification_complete。
* CTA behavior: 前端优先信任后端 clarificationComplete / ready_for_design 决策，展示“继续丰富需求 / 开始施工”。

### 4. 项目切换隔离

* projectId: DSLWorkbench effect 仅按 projectId 触发清空和加载。
* requirementId: requirement 必须属于当前 projectId 才允许加载。
* runId: 项目切换时 runState 重置为 idle，避免旧 runId/artifacts 泄漏。
* transient state cleared: messages、inputGateActive、uiState、polling 都在项目切换时清理。

### 5. 未触碰范围

* monitor mapping unrelated: not touched。
* agent timeline: not touched。
* agent2: not touched。
* skills: not touched。
* performance: not touched。

### 6. 跳过测试说明

* skipped tests: yes, per user instruction。
* integration gate required: yes。

### 7. 安全检查

* api key leakage: no。
* local config committed: no。
* local db committed: no。
* runs committed: no。
* node_modules committed: no。
* dist committed: no。
* real repo write performed: no。

### 8. Git / Push

* commit: see final response。
* pushed: see final response。
* branch: main。
