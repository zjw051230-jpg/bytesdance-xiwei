# DSL Clarification Unblock + Enter Send Report

## Summary

修复 DSL 澄清流程在用户回答短文本（如“去重”“24h去重”）后被 input gate 误拦截的问题，并为澄清输入框增加 Enter 发送、Shift+Enter 换行、IME 组合输入保护和 Enter 发送中防重复提交。

## Root Cause

1. 前端 `DSLWorkbench` 对所有短输入统一执行本地 `inputIntentGate`，没有区分“初始需求输入”和“已有澄清问题后的 PM 回答”，导致已有需求上下文中的短回答被误判为 `too_short`，页面提示“请补充你想澄清或生成 DSL 的需求”。
2. 后端 `runSkillTurn` 同样只看最新 PM 文本，未识别 `system_clarification` 历史，因此直接调用 API 时也可能 gate 掉短回答。
3. `ClarificationChat` 原输入框没有 Enter key handler，按 Enter 不会发送；也没有 IME 组合输入和重复 Enter 提交保护。

## Fix

1. `DSLWorkbench` 新增 active clarification context 判断：存在 active requirement、runId 或历史系统澄清问题时，短回答继续进入 skill turn。
2. `skillOrchestrator` 新增澄清问题上下文判断：空输入仍 gate；但带有系统澄清历史的短 PM 回答不再 gate。
3. `ClarificationChat` 将输入控件改为 textarea：
   - Enter 发送。
   - Shift+Enter 保留换行。
   - IME composition 中不误提交。
   - Enter 发送中不重复提交。
   - 空输入按钮不可用，空 Enter 不发送。
4. `DSLWorkbench` 对 `clarificationComplete=true`、`handoff_decision=clarification_complete/ready_for_design`、或问题队列为空的 skill turn 统一进入完成态，并保持右侧 readiness 为 `clarification_complete`。

## Completion CTA

完成态显示文案：

当前需求已经具备进入设计规划的基础信息。你可以继续补充细节，也可以开始施工。

按钮：

- 继续完善需求：留在 DSL 澄清页，输入框继续可用。
- 开始施工：切换到设计规划页，不触发 Agent，不写业务 repo。

## Scope Safety

- 未修改 `agent(2)/`。
- 未修改 `server/services/agent2Adapter.js`。
- 未修改 `server/services/agentExecutionService.js`。
- 未修改 `vite.config.js` / `vite.config.mjs`。
- 未修改 warmup / watch ignore / lazy import 性能策略。
- 未执行 `npm run dev`。
- 未执行 `npm run smoke` / `npm run verify`。
- 未执行 `taskkill`。
- 未进入真实 Agent 执行。
- 未真实写业务 repo。

## Tests

通过：

- `npm test`：14 files passed, 139 tests passed。
- `npm run test:server`：8 files passed, 83 tests passed。
- `npm run build`：Vite production build passed。

补充覆盖：

- 已有澄清上下文里的短回答“去重”继续进入 `/api/skill/pm-dsl-turn`。
- Enter 发送澄清输入。
- Shift+Enter 不发送。
- Enter 发送中不重复提交。
- 后端已有 `system_clarification` 历史时不 gate 短 PM 回答。

## Manual Verification

未启动或重启前后端进行人工浏览器验证，因为任务明确禁止 `npm run dev`、重启前端/后端，以及不允许干扰 9999/8787。当前验证以允许的自动化测试和 build 为准。
