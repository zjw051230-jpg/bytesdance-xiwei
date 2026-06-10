## Review Audit Page Visibility 完成报告

### 1. 修改文件

- `src/components/ReviewCheckWorkbench.jsx`
- `src/styles.css`
- `reporting/review_audit_page_visibility_report.md`
- `reporting/review_audit_page_visibility_summary.json`

### 2. 旧问题

- preview blank: 原页面把 preview iframe 放在左侧大区域，空白时仍占据主要视野。
- diff too small: Diff Viewer 位于左侧底部，空间偏低，长 diff 难以阅读。
- audit panel too narrow: 右侧同时承载状态、文件、回退、证据和 PR 入口，视觉层级不清。
- changed files not visible: changed files 被放在右侧窄栏，用户进入审计页后不够直观。

### 3. 新布局

- header: 顶部展示项目、runId、realWritePerformed、changed files 数量、verification、rollback 状态。
- diff area: 中间左侧优先展示 Changed Files 和 Diff Viewer，diff 最小高度提升到 40vh 并可滚动。
- audit side panel: 中间右侧保留 rollback、changed files 摘要、用户可见变化、验收映射、测试证据、rollback history、PR 入口。
- preview collapse: preview iframe 下移到底部，默认折叠，只显示一条预览状态栏。

### 4. 可读性改进

- changed files: 变更文件列表提升到 diff 上方，支持选择文件、回退单文件，并在右侧同步显示紧凑摘要。
- diff viewer: 使用等宽字体、独立深色面板、可滚动区域和更明确的空状态。
- rollback: 顶部摘要显示 rollback 状态，右侧 Rollback Inspector 保持可操作。
- evidence: 测试证据和验收映射保持独立 section，无内容时显示短 empty state。
- PR entry: 进入 PR 页面按钮保留在右侧底部清晰位置。

### 5. 未触碰范围

- real agent backend: no
- DSL: no
- monitor: no
- risk chat: no
- agent work matrix: no
- skills: no
- agent2 raw: no
- conduit fork: no

### 6. 跳过测试说明

- skipped tests: yes, per user instruction
- integration gate required: yes
- static check: `git diff --check` passed, with CRLF warnings only

### 7. 安全检查

- api key leakage: no
- local config committed: no
- db committed: no
- runs committed: no
- dist committed: no
- node_modules committed: no
- pycache committed: no
- real repo write performed: no

### 8. Git / Push

- commit: pending
- pushed: pending
- branch: ZJWNB
