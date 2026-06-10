## Agent Work Matrix Status Fix 完成报告

### 1. 修改文件

- `src/components/AgentWorkMatrix.jsx`
- `reporting/agent_work_matrix_status_fix_report.md`
- `reporting/agent_work_matrix_status_fix_summary.json`

### 2. 根因

* RequirementAgent stuck running because: `AgentWorkMatrix` 在 `isStarting=true` 且当前 stages 没有 running 时，会合成第一个阶段 `RequirementAgent` 为 `running`。当真实 run 已完成但 React 状态仍短暂保留 `isStarting` 时，这个 fallback 会覆盖终态展示。
* conflicting state sources: 组件同时消费 `stageEvents` / `activityTimeline`，但之前没有终态优先的归一化规则。
* stale currentStage: 本次未发现需要依赖 `currentStage` 修复，问题集中在矩阵 synthetic running。
* fallback running logic: fallback running 没有检查 `completed / finished / no_changes / realWritePerformed / SummaryAgent completed`。

### 3. 修复内容

* stage normalization: 增加终态归一化，先判断 run 是否已结束，再决定是否允许 running。
* completed run handling: `completed / finished / done / success / passed / no_changes` 不再允许任何 stage 保持 running。
* SummaryAgent completed handling: `SummaryAgent` completed 时，前置非 failed/blocked/skipped 阶段归一为 completed。
* realWritePerformed handling: `realWritePerformed=true` 视为真实执行已结束，RequirementAgent 以及其它非异常阶段归一为 completed。
* no fake running: 只有非终态 run 且没有真实 running stage、同时 `isStarting=true` 时，才允许合成启动中的 RequirementAgent。

### 4. 状态规则

* no run: 全部 idle，标题显示等待 Agent run 或 stageEvents。
* running: 仅在 `running / processing / generating / queued / active / in_progress / working` 或明确 running stage 时显示 running。
* completed: 终态 run 或 SummaryAgent completed 时，不显示任何 spinner，标题显示 Agent run 已完成。
* failed: run failed 或 stage failed 时显示失败，不显示 Loader。
* blocked: run blocked 或 stage blocked 时显示阻断，不显示 Loader。

### 5. 未触碰范围

* review conduit preview: false
* DSL artifacts input gate: false
* real agent backend: false
* monitor: false
* risk chat: false
* skills: false
* agent2 raw: false
* conduit fork: false

### 6. 跳过测试说明

* skipped full tests: yes, per user instruction
* integration gate required: yes
* 已执行: `git diff --check`
* 已执行静态检查: `Select-String` 搜索 `RequirementAgent 正在工作`、`status === "running"`、`currentStage`

### 7. 安全检查

* api key leakage: none
* local config committed: no
* db committed: no
* runs committed: no
* dist committed: no
* node_modules committed: no
* pycache committed: no
* real repo write performed: no

### 8. Git / Push

* commit: `fix: normalize agent work matrix completed status`
* pushed: true
* branch: `ZJWNB`
