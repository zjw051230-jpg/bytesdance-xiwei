## Task 13.7 Verify Render Locator Fix 完成报告

### 1. 根因
- old locator: `getByRole("button", { name: "监控台" })` in `enterWorkbench` and `enterDesignPlanning`.
- why it failed: the current Workbench flow can enter the picker/workspace state where `TopBar` renders `.workspace-top-tabs` instead of the old monitor-mode `监控台` / `工作台` buttons. The verification script was waiting on a stale monitor-only entry element before it checked the actual app shell.

### 2. 修改文件
- `scripts/verify-render.mjs`
- `reporting/real-dsl-render-verification.json`
- `reporting/design-planning-render-verification.json`
- `reporting/verify_render_fix_report.md`
- `reporting/verify_render_fix_summary.json`

### 3. 新定位策略
- primary locators: `#root > *`, `Codex Workbench`, `[data-testid="workspace-shell"]`, `.workspace-top-tabs`, `[data-testid="workspace-project-picker"]`, `[data-testid="dsl-workbench"]`, `[data-testid="design-planning-workbench"]`.
- fallback locators: exact top-tab buttons `DSL 澄清台`, `设计规划`, `审阅检查`, `PR 页面`, plus `工作台` only when the app is still in monitor mode.
- timeout: app readiness and workbench entry waits use 90000 ms; navigation commits first, then waits opportunistically for `domcontentloaded` and `networkidle`.

### 4. 验证内容
- 1920x1080: passed for DSL workbench and design planning.
- 1440x900: passed for DSL workbench and design planning.
- top tabs: verified visible with exact tab locators for `DSL 澄清台`, `设计规划`, `审阅检查`, `PR 页面`.
- left rail: verified through `[data-testid="project-rail"]`.
- main content: verified through `.workspace-content` and page-specific workbench test ids.
- no page vertical scroll: verified with document/body scroll height less than or equal to viewport height plus 6 px tolerance.

### 5. 测试结果
- verify-render: passed.
- npm test: passed, 9 files and 97 tests.
- build: passed.
- smoke: passed.
- test:server: passed, 3 files and 57 tests.
- check:standalone: passed.

### 6. 截图路径
- `reporting/render-1920x1080.png`
- `reporting/render-1440x900.png`
- `reporting/real-dsl-workbench-running-1920x1080.png`
- `reporting/real-dsl-workbench-running-1440x900.png`
- `reporting/real-dsl-workbench-result-1920x1080.png`
- `reporting/real-dsl-workbench-result-1440x900.png`
- `reporting/real-dsl-report-modal-1920x1080.png`
- `reporting/real-dsl-report-modal-1440x900.png`
- `reporting/design-planning-page-1920x1080.png`
- `reporting/design-planning-page-1440x900.png`
- `reporting/workspace-top-tabs.png`

### 7. 安全检查
- api key leakage: false; staged/candidate scan found no credential-shaped values.
- local config committed: false.
- local db committed: false.
- runs committed: false.
- node_modules committed: false.
- dist committed: false.

### 8. Git / Push
- commit: `f1d4b82866911ee26f3c90194ad9f4bc5df0232d` (`fix: stabilize render verification locator`).
- pushed: true.
- branch: `main`.

### 9. 是否建议返工
- 不建议返工。后续如 UI 入口再次变化，应继续以 workspace shell/test id 作为验证锚点，而不是监控台模式按钮。
