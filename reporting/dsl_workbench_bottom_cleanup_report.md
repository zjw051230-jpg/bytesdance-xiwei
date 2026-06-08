## Task 11.4-B Clarification Workbench Bottom Interaction Cleanup 完成报告

### 1. 修改文件

- `src/components/ClarificationChat.jsx`
- `src/styles.css`
- `src/App.test.jsx`
- `scripts/verify-render.mjs`
- `reporting/dsl-workbench-bottom-cleanup-verification.json`
- `reporting/dsl-workbench-bottom-clean-1920x1080.png`
- `reporting/dsl-workbench-bottom-clean-1440x900.png`
- `reporting/dsl-workbench-suggestion-visible-1920x1080.png`
- `reporting/dsl-workbench-bottom-clean-report-modal-1920x1080.png`
- `reporting/dsl-workbench-bottom-clean-report-modal-1440x900.png`

### 2. 删除 / 隐藏内容

- 生成 DSL: 已从底部输入区移除，不再作为常驻按钮出现。
- 重新生成问题: 已从底部输入区移除，不再作为常驻按钮出现；仅保留推荐卡内部的 `换一个`。

### 3. 保留内容

- 发送回答: 保留，仍可追加 mock PM 回答并显示 toast。
- 输入框: 保留 `输入 PM 回答或补充需求...`。
- 打开需求报告: 保留右侧 DSL 状态控制台主 CTA，仍可打开报告 modal。

### 4. 推荐澄清问题显示策略

- 触发间隔: 使用固定 mock 序列 `[6, 8, 10, 7]`，初始 `nextSuggestionAt = 6`；推荐卡默认隐藏，连续 6 次发送后出现。
- 采用: 点击 `采用这个问题` 会追加一条系统澄清消息，隐藏推荐卡，并设置下一次间隔。
- 换一个: 点击 `换一个` 只替换当前推荐问题，不增加 messageCount，不关闭卡片。
- 暂时跳过: 点击 `暂时跳过` 会隐藏推荐卡，设置下一次间隔，并显示 `已暂时跳过` toast。

### 5. 单屏布局

- 1920x1080: 通过，主工作台 `hasVerticalPageScroll: false`。
- 1440x900: 通过，主工作台 `hasVerticalPageScroll: false`。
- hasVerticalPageScroll: 主工作台、推荐卡交互后、报告 modal 打开后均为 `false`。

### 6. 测试方式

- `npm test`
- `npm run build`
- `npm run smoke`
- `node scripts\verify-render.mjs`
- 静态安全扫描：API key、真实 API 调用、真实导出实现、禁用链路关键词、`.env*`。

### 7. 测试结果

- `npm test`: 2 个测试文件通过，12 个测试通过。
- `npm run build`: Vite production build 通过，1726 modules transformed。
- `npm run smoke`: 通过。
- `node scripts\verify-render.mjs`: 通过。
- 渲染验证结果: `consoleEntries: []`，`pageErrors: []`。
- 底部按钮验证: `persistentGenerateDslCount: 0`，`persistentRegenerateQuestionCount: 0`，`hasSendAnswer: true`。
- 推荐卡验证: 初始 `0`，发送 5 次后 `0`，发送第 6 次后 `1`；`换一个` 后仍显示；`暂时跳过` 后隐藏；1440x900 视口验证 `采用这个问题` 后隐藏。

### 8. 截图路径

- `F:\字节比赛\最终程序\reporting\dsl-workbench-bottom-clean-1920x1080.png`
- `F:\字节比赛\最终程序\reporting\dsl-workbench-bottom-clean-1440x900.png`
- `F:\字节比赛\最终程序\reporting\dsl-workbench-suggestion-visible-1920x1080.png`

### 9. 安全检查

- api key leakage: false
- real API connected: false
- real export files: false
- `.env*`: 未发现
- forbidden chain: 未发现 `hunter` / `auto-reply` / `A3B`

### 10. 是否建议返工

不建议返工。底部交互已经从工程操作面板收敛为真实 PM 对话输入区，推荐澄清问题改为间隔式辅助建议，同时保持右侧报告入口和单屏布局。
