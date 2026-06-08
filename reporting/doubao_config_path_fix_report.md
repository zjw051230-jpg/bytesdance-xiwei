## Task 12.2-H2 Doubao Config Path Fix 完成报告

### 1. 根因
- 上一轮 Doubao 客户端默认读取 `F:\dsl-v2\configs\doubao_api_config.local.json`。
- 实际已填写配置位于 `F:\dsl-v2\configs\api_config.local.json`。
- 因此 `npm run check:doubao` 报 `doubao_config_missing`，根因是配置路径错误，不是 Doubao Ark 接口不可用。

### 2. 修改文件
- `F:\字节比赛\最终程序\server\services\doubaoArkClient.js`
- `F:\字节比赛\最终程序\scripts\check-doubao-ark.mjs`
- `F:\字节比赛\最终程序\server\server.test.js`
- `F:\字节比赛\最终程序\reporting\doubao_config_path_fix_report.md`
- `F:\字节比赛\最终程序\reporting\doubao_config_path_fix_summary.json`

### 3. 新配置读取规则
- 当前读取路径: `F:\dsl-v2\configs\api_config.local.json`
- 旧错误路径: `F:\dsl-v2\configs\doubao_api_config.local.json`
- provider: 必须为 `doubao_ark`
- base_url: 缺省使用 `https://ark.cn-beijing.volces.com/api/v3`
- chat_completions_path: 缺省使用 `/chat/completions`
- model 优先级: `model` -> `endpoint_id`
- api_key: 只用于 `Authorization: Bearer <redacted>`，不写入报告、前端或工件
- 当前本机配置状态: `provider=doubao_ark`, `endpoint_id present=true`, `apiKeyPresent=true`, `model present=false`, `base_url present=false`, `chat path present=false`

### 4. check:doubao 结果
- command: `npm run check:doubao`
- status: `passed`
- provider: `doubao_ark`
- baseURL: `https://ark.cn-beijing.volces.com/api/v3`
- model: `ep-20260514110933-mzh58`
- apiKeyPresent: true
- latencyMs: 1757
- errorCode: empty
- result file: `F:\字节比赛\最终程序\reporting\doubao-ark-check-result.json`

### 5. Web L1 smoke 结果
- command: `npm run smoke:web-ui-real-skill-l1`
- status: `passed`
- url: `http://127.0.0.1:9999`
- run id: `RUN-20260608-135316-5B7FE`
- source.mode: `model_generated_real`
- source.provider: `doubao_ark`
- source.client: `doubao_ark`
- source.model: `ep-20260514110933-mzh58`
- mockUsed: false
- ready_for_agent: false
- can_handoff_to_agent: false
- handoff_decision: `clarify_first`
- pageVerticalScroll: false
- consoleEntries: none
- pageErrors: none

### 6. 回归测试
- `npm test`: passed, 6 test files, 65 tests
- `npm run test:server`: passed, 2 test files, 38 tests
- `npm run build`: passed
- `npm run smoke`: passed
- `node scripts\verify-render.mjs`: passed
- verify-render URL: `http://127.0.0.1:9999`
- verify-render API health: `http://127.0.0.1:9999/api/health`
- verify-render page vertical scroll: false at `1920x1080` and `1440x900`
- verify-render console/page errors: none

### 7. 截图路径
- `F:\字节比赛\最终程序\reporting\doubao-l1-main.png`
- `F:\字节比赛\最终程序\reporting\doubao-l1-source-badge.png`
- `F:\字节比赛\最终程序\reporting\doubao-l1-report.png`

### 8. 安全检查
- API key printed: false
- API key written to report: false
- API key returned to frontend: false
- Authorization leakage: false
- artifactLeakage: false
- scanned result/artifact files: 7
- Agent Plan entered: false
- Agent Handoff entered: false
- code execution entered: false
- mock success used: false
- `F:\dsl` modified: false
- `F:\dsl-v2` core/runtime modified: false

### 9. 是否建议返工
- 不建议返工。
- 配置路径已修复为 `api_config.local.json`，真实 Doubao health check 和 Web L1 smoke 均已通过。
