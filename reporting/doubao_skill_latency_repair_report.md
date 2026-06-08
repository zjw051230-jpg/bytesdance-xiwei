## Task 12.2-I Doubao Skill Turn Latency Repair 完成报告

### 1. 原始问题
- check:doubao: 已通过，说明 api_key / endpoint / baseURL 不是根因。
- Web UI error: 人工测试曾出现 `doubao_timeout / Doubao Ark request timed out`，右侧进入 external_blocked。
- why it was not config issue: `npm run check:doubao` 可稳定访问 `https://ark.cn-beijing.volces.com/api/v3/chat/completions`，本轮最终 health check 也通过。

### 2. 根因
- prompt size: 旧 run prompt 文件约 15840 chars；修复后 Web L1 diagnostics promptChars 为 5931。
- context size: 旧逻辑最多传 12 条对话和较完整 UI 状态；修复后 fast skill turn 只传最近 6 条，并压缩 DSL / risk / readiness。
- output size: 旧输出期望完整 current_dsl_summary + human_report_patch；修复后 fast turn 采用 lightweight JSON，report modal 由本地 adapter 再补齐。
- timeout: 旧默认 fast skill timeout 为 12s；修复后默认 60s，并支持读取 `api_config.local.json` 的 `timeout_seconds`，Web L1 smoke 覆盖为 90s。

### 3. 修改文件
- `F:\字节比赛\最终程序\server\prompts\pm_to_dsl_fast_skill_turn.md`
- `F:\字节比赛\最终程序\server\services\skillPromptLoader.js`
- `F:\字节比赛\最终程序\server\services\skillOrchestrator.js`
- `F:\字节比赛\最终程序\server\services\doubaoArkClient.js`
- `F:\字节比赛\最终程序\src\components\DSLWorkbench.jsx`
- `F:\字节比赛\最终程序\scripts\check-doubao-skill-turn.mjs`
- `F:\字节比赛\最终程序\scripts\smoke-real-skill-l1.mjs`
- `F:\字节比赛\最终程序\server\server.test.js`
- `F:\字节比赛\最终程序\package.json`

### 4. 修复内容
- prompt diet: 新增 fast wrapper，只保留 PM-to-DSL 澄清规则和轻量输出 schema。
- context limit: server 和 UI 都限制最近 6 条消息；previousUiState / risk / DSL draft 均做摘要化。
- lightweight output: 支持模型只返回 `assistant_message`、`clarification`、`dsl_patch`、`risk_boundary`、`source`。
- timeout config: Doubao config 支持 `timeout_seconds`；fast skill 默认 60s；Web L1 smoke 使用 90s。
- diagnostics: 每轮 skill turn 写入 `runs\<runId>\skill_turn_diagnostics.json`，包含 promptChars / messageCount / timeoutMs / latencyMs / status，不含 API key。

### 5. 分层连通性测试
- check:doubao: passed, latencyMs 2789, model `ep-20260514110933-mzh58`
- check:doubao-skill-minimal: passed, latencyMs 12499, promptChars 3978, messageCount 2
- check:doubao-skill-l1: passed, latencyMs 14939, promptChars 4106, messageCount 2

### 6. Web UI L1 测试
- status: passed
- run id: `RUN-20260608-172328-8V9VZ`
- source.provider: `doubao_ark`
- source.model: `ep-20260514110933-mzh58`
- mockUsed: false
- assistant_message: real Doubao PM-facing clarification returned
- ready_for_agent: false
- handoff_decision: clarify_first
- latencyMs: 16515
- promptChars: 5931
- diagnosticsStatus: passed

### 7. 测试命令
- `npm test`
- `npm run test:server`
- `npm run build`
- `npm run smoke`
- `node scripts\verify-render.mjs`
- `npm run check:doubao`
- `npm run check:doubao-skill-minimal`
- `npm run check:doubao-skill-l1`
- `npm run smoke:web-ui-real-skill-l1`

### 8. 测试结果
- `npm test`: passed, 6 files / 67 tests
- `npm run test:server`: passed, 2 files / 40 tests
- `npm run build`: passed
- `npm run smoke`: passed
- `node scripts\verify-render.mjs`: passed after clearing stale local 8787/9999 dev process; `http://127.0.0.1:9999/api/health` passed; no console/page errors; no page vertical scroll at 1920x1080 and 1440x900
- `npm run check:doubao`: passed
- `npm run check:doubao-skill-minimal`: passed
- `npm run check:doubao-skill-l1`: passed
- `npm run smoke:web-ui-real-skill-l1`: passed

### 9. 截图路径
- `F:\字节比赛\最终程序\reporting\doubao-skill-l1-fast-success.png`
- `F:\字节比赛\最终程序\reporting\doubao-skill-l1-source-badge.png`
- `F:\字节比赛\最终程序\reporting\doubao-l1-report.png`

### 10. 安全检查
- api key leakage: false
- Authorization leakage: false
- Agent Plan: not entered
- Agent Handoff: not entered
- Code execution: not entered
- mock success: false
- scanned files: 10 latest reports / artifacts
- `F:\dsl`: not modified
- `F:\dsl-v2` core/runtime: not modified

### 11. 是否建议返工
- 不建议返工。
- prompt diet、上下文限制、轻量输出、可配置 timeout 和 diagnostics 均已落地；真实 Doubao L1 与 Web UI smoke 均通过。
