## Task 12.2-E Real Skill Model Integration 完成报告

### 1. 原始问题
- mock/canned response: `/api/skill/pm-dsl-turn` 在没有显式 endpoint 时默认走本地 mock，并把 mock 标记为 `model_generated`。
- why it looked like system auto reply: L1/L2/L3 canned answer 在人工路径中也可能出现，UI 没有显示真实来源，PM 侧无法区分 real / fallback / mock。

### 2. 根因
- default mock: `skillOrchestrator` 旧逻辑为 `endpoint ? openai-compatible : mock`。
- L1/L2/L3 canned path: canned classifier 存在于 mock model 中，但旧 source 标签会让它像真实模型输出。
- missing real API call: 人工 Web UI 默认没有读取 `F:\dsl-v2\configs\api_config.local.json` 并调用 OpenAI-compatible `/chat/completions`。

### 3. 修改文件
- `server/services/skillOrchestrator.js`
- `server/routes/skill.js`
- `server/prompts/pm_to_dsl_skill_orchestration.md`
- `server/server.test.js`
- `src/components/DSLWorkbench.jsx`
- `src/components/DSLStatusConsole.jsx`
- `src/styles.css`
- `src/App.test.jsx`
- `scripts/smoke-real-skill-l1.mjs`
- `scripts/verify-render.mjs`
- `package.json`

### 4. 修复内容
- real model default: 非 test 且未显式 mock 时默认读取 `F:\dsl-v2\configs\api_config.local.json`，调用 `http://localhost:8317/v1/chat/completions`。
- mock only in test: `NODE_ENV=test`、`SKILL_MODEL_MODE=mock`、测试显式 mock 才走 mock；mock source 现在是 `mock`。
- OpenAI-compatible call: 保存脱敏后的 `skill_turn_api_request.json` 与 `skill_turn_api_response_raw.json`。
- source badge: 右侧状态台显示 `回复来源：Real model · <model>`、`Fallback guardrail`、`Mock model` 或 `External blocked`。
- skill turn artifacts: 每轮保存 input、prompt、API request、API response raw、parsed response。
- fallback/error behavior: invalid JSON 返回 `model_invalid_json` guardrail；真实 API 不可用或超时返回 `external_blocked`，不回退 mock。

### 5. 真实 UI L1 结果
- status: `external_blocked`
- run id: `RUN-20260608-111128-QEX8P`
- model: `gpt-5.5`
- source.mode: `external_blocked`
- assistant_message: `系统提示：本轮 DSL 生成失败，原因：model_timeout / Skill model request timed out。已保留结构化错误信息，请检查右侧状态。`
- artifact paths:
  - `F:\字节比赛\最终程序\runs\RUN-20260608-111128-QEX8P\skill_turn_input.json`
  - `F:\字节比赛\最终程序\runs\RUN-20260608-111128-QEX8P\skill_turn_prompt.md`
  - `F:\字节比赛\最终程序\runs\RUN-20260608-111128-QEX8P\skill_turn_api_request.json`
  - `F:\字节比赛\最终程序\runs\RUN-20260608-111128-QEX8P\skill_turn_api_response_raw.json`
  - `F:\字节比赛\最终程序\runs\RUN-20260608-111128-QEX8P\skill_turn_response_parsed.json`
- ready_for_agent: 未进入真实模型成功响应；parsed error 为 external_blocked。
- raw EVPI exposed: 未发现 raw EVPI 作为模型回复。
- mock used: `false`

### 6. 测试方式
- `npm test`
- `npm run test:server`
- `npm run build`
- `npm run smoke`
- `node scripts\verify-render.mjs`
- `npm run smoke:web-ui-skill-l1-l3`
- `npm run smoke:skill-fast-latency`
- `npm run smoke:web-ui-real-skill-l1`

### 7. 测试结果
- `npm test`: passed, 6 files / 57 tests.
- `npm run test:server`: passed, 2 files / 30 tests.
- `npm run build`: passed.
- `npm run smoke`: passed.
- `node scripts\verify-render.mjs`: passed, 1920x1080 and 1440x900 no page vertical scroll; modal no page vertical scroll.
- `npm run smoke:web-ui-skill-l1-l3`: passed.
- `npm run smoke:skill-fast-latency`: passed.
- `npm run smoke:web-ui-real-skill-l1`: `external_blocked`, exit 1 by design because real model timed out instead of passing falsely.

### 8. 截图路径
- `F:\字节比赛\最终程序\reporting\real-skill-l1-main.png`
- `F:\字节比赛\最终程序\reporting\real-skill-l1-source-badge.png`
- `F:\字节比赛\最终程序\reporting\real-skill-l1-external-blocked.png`
- `F:\字节比赛\最终程序\reporting\real-dsl-workbench-result-1920x1080.png`
- `F:\字节比赛\最终程序\reporting\real-dsl-workbench-result-1440x900.png`

### 9. 安全检查
- api key leakage: false
- Authorization leakage: false
- api_config returned: false
- Agent Plan: false
- Agent Handoff: false
- Code execution: false

### 10. 已知限制
- 本轮真实模型 endpoint `http://localhost:8317/v1/chat/completions` 在 UI smoke 中 30s 超时，真实 L1 未能获得 `model_generated_real` 响应。
- 已按要求记录 `external_blocked`，未使用 mock 冒充真实成功。

### 11. 是否建议返工
- 不建议返工代码；建议恢复或排查本地真实模型服务后重跑 `npm run smoke:web-ui-real-skill-l1`。
