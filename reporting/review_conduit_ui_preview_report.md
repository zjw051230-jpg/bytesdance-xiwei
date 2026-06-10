## Review Conduit UI Preview 完成报告

### 1. 修改文件

- `src/components/ReviewCheckWorkbench.jsx`
- `src/styles.css`
- `reporting/review_conduit_ui_preview_report.md`
- `reporting/review_conduit_ui_preview_summary.json`

### 2. 旧问题

- main area showed diff: yes，主区域优先展示 changed files / Diff Viewer。
- preview hidden: yes，页面预览被放到底部折叠区。
- user could not see Conduit UI: yes，用户进入审计页第一眼看不到业务项目运行界面。

### 3. 新布局

- preview as main: yes，主区域左侧默认展示 Conduit UI iframe，最小高度 65vh。
- audit panel: yes，右侧保留 Agent Real-run Audit、Rollback Inspector、Changed Files 摘要、用户可见变化、验收映射、测试证据、PR 入口。
- diff secondary: yes，Changed Files + Diff Viewer 移到底部“代码变更”折叠区。
- fallback: yes，无 previewUrl 或 iframe 失败时显示启动提示、previewUrl 和外部打开入口。

### 4. previewUrl 来源

- run: `agentWorkflow.previewUrl` / `agentWorkflow.run.previewUrl` / `agentWorkflow.result.previewUrl` / review 或 artifact previewUrl。
- project: `activeProject.previewUrl` / `activeProject.devUrl`。
- inferred conduit URL: 项目名称、id、路径或 localPath 包含 conduit 时推断 `http://127.0.0.1:3000/#/login`。
- empty state: 显示“请启动 Conduit 应用，例如在目标仓库运行 start-dev 脚本，然后回到此页面刷新预览。”

### 5. 未触碰范围

- agent real-run backend: no
- DSL: no
- monitor: no
- risk chat: no
- agent matrix: no
- skills: no
- conduit fork: no

### 6. 跳过测试说明

- skipped tests: yes, per user instruction
- integration gate required: yes
- static check: `git diff --check -- src/components/ReviewCheckWorkbench.jsx src/styles.css` passed, with CRLF warnings only

### 7. Git / Push

- commit: pending
- pushed: pending
- branch: ZJWNB
