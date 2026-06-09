## Task 13.1 Workspace Top Tabs + Design Planning Page 完成报告

### 1. 修改文件
- `src/components/AppShell.jsx`
- `src/components/TopBar.jsx`
- `src/components/WorkspaceShell.jsx`
- `src/components/WorkspaceTopTabs.jsx`
- `src/components/DesignPlanningWorkbench.jsx`
- `src/data/planningWorkbenchData.js`
- `src/App.test.jsx`
- `src/styles.css`
- `scripts/smoke.mjs`
- `scripts/smoke-design-planning.mjs`
- `scripts/verify-render.mjs`
- `package.json`
- `reporting/design-planning-render-verification.json`

### 2. 页面结构调整
- top tabs: 顶栏工作台态显示 `DSL 澄清台 / 设计规划 / 审阅检查 / PR 页面`，设计规划选中时有蓝色高亮。
- left global rail: 左侧 rail 保持项目/全局功能入口，不承载 DSL / 设计规划 / 审阅检查 / PR 主页面切换。
- DSL page: 保留原 `需求澄清工作台` 与 `DSL 状态控制台`，点击 `DSL 澄清台` 可回到 DSL 页面。
- design planning page: 新增独立 `设计规划` 页面，右侧为规划专属状态面板，不显示 `DSL 状态控制台`。

### 3. 设计规划页内容
- requirement summary: 显示登录失败提示优化、目标、当前阶段、负责人、执行角色和阶段进度。
- milestones: 显示 `实施阶段 / 里程碑` 纵向 timeline。
- task breakdown: 显示 `任务拆解清单`，含负责人、状态和预计完成日期。
- execution feedback: 显示 `执行摘要 / 最新进展`，用于表达完成情况动态反馈。
- right planning panel: 显示 `总体进度 / 当前阶段状态 / 风险 / 阻塞项 / 下一步建议`。

### 4. 交互
- switch to DSL: 顶部点击 `DSL 澄清台` 返回原 DSL 页面。
- switch to design planning: 顶部点击 `设计规划` 进入新页面。
- placeholder pages: `审阅检查` 与 `PR 页面` 先显示 `即将开放` 占位页，Tab 保持可见。

### 5. 测试方式
- `npm test`
- `npm run test:server`
- `npm run build`
- `npm run smoke`
- `npm run smoke:design-planning`
- `node scripts\verify-render.mjs`

### 6. 测试结果
- `npm test`: passed, 6 files / 69 tests.
- `npm run test:server`: passed, 2 files / 40 tests.
- `npm run build`: passed, no CSS warning after cleanup.
- `npm run smoke`: passed.
- `npm run smoke:design-planning`: passed.
- `node scripts\verify-render.mjs`: passed.
- 1920x1080 design page: hasVerticalPageScroll=false, consoleEntries=[], pageErrors=[].
- 1440x900 design page: hasVerticalPageScroll=false, consoleEntries=[], pageErrors=[].
- DSL modal verification: hasVerticalPageScroll=false.

### 7. 截图路径
- `F:\字节比赛\最终程序\reporting\design-planning-page-1920x1080.png`
- `F:\字节比赛\最终程序\reporting\design-planning-page-1440x900.png`
- `F:\字节比赛\最终程序\reporting\workspace-top-tabs.png`

### 8. 安全检查
- API key leakage: false
- Agent Plan: false
- Agent Handoff: false
- Code execution: false
- PM→DSL runner logic changed: false
- `F:\dsl` modified: false
- `F:\dsl-v2 runtime` modified: false

### 9. 是否建议返工
- 不建议返工。当前实现已完成顶部一级页面切换、设计规划页、右侧专属状态面板、占位页和单屏验证。
