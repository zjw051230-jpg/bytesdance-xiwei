## Task DSL Report CTA Mapping Fix 完成报告

### 1. 根因
- DSL 状态控制台底部 CTA 只有固定文案和 `onOpenReport`，没有独立的 report-ready 状态映射。
- 项目选择 toast 会在工作台底部区域显示 `已选择 conduit-realworld-example-app`，视觉上容易被误认为报告 CTA 的 badge。
- CTA 没有区分当前 DSL run 是否已有可打开报告，导致无 run 时也能打开报告 modal。

### 2. 修改文件
- `F:\字节比赛\最终程序\src\components\DSLStatusConsole.jsx`
- `F:\字节比赛\最终程序\src\styles.css`
- `F:\字节比赛\最终程序\src\App.test.jsx`
- `F:\字节比赛\最终程序\reporting\dsl_report_cta_mapping_fix_report.md`
- `F:\字节比赛\最终程序\reporting\dsl_report_cta_mapping_fix_summary.json`

### 3. 修复后的 CTA 映射
- report CTA 只读取 `runState.runId`、`runState.status`、`runState.artifactStatus`、`runState.artifacts`、`reportPath`、`reportUrl`。
- 不读取、不展示 `activeProject.name` / `selectedProject`。
- 有报告时显示：
  - 标题：打开需求报告
  - 副标题：以人类可读方式审阅当前 DSL
  - badge：`DSL run passed` 或 `report ready`
- 无报告时显示：
  - 标题：打开需求报告
  - 副标题：当前还没有可打开的 DSL 报告
  - badge：未生成
  - 按钮 disabled

### 4. 点击行为
- report ready 时：点击打开当前 run 的需求报告 modal。
- report 未生成时：按钮 disabled，不打开 modal，也不误导用户。
- 项目选择状态仍在项目区域/页面其他位置显示，不进入 report CTA。

### 5. 测试结果
- `npx vitest --run src/App.test.jsx`: passed，29 tests passed。
- `npm test`: passed，11 files / 126 tests passed。
- `npm run test:server`: passed，5 files / 77 tests passed。
- `npm run build`: passed。
- `npm run smoke`: passed。
- `npm run verify`: passed after stopping stale local project dev servers on 8787 and 9999.

### 6. 验证覆盖
- 选中 `conduit-realworld-example-app` 时，`.report-cta` 不显示项目名。
- 无 run 时，CTA 显示未生成并禁用。
- passed run 且有报告 artifact 时，CTA 显示 `DSL run passed` 并调用当前 report open handler。
- failed/timeout 但已有快速报告内容时，CTA 仍使用“打开需求报告”，badge 显示 `report ready`。
- verify-render 确认 1920x1080 和 1440x900 无页面级纵向滚动。

### 7. 安全检查
- api key leakage: false
- local config committed: false
- local db committed: false
- runs committed: false
- node_modules committed: false
- dist committed: false
- Agent dry-run: not touched
- DSL core modules: not touched
- audit preview launcher: not touched

### 8. 是否建议返工
- 不建议返工。
