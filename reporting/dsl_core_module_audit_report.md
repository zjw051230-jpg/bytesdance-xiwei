## DSL Core Module Audit / Restore 完成报告

### 1. 审计结论

* Project Skeleton: present
* DSL Schema v0: restored
* Risk Factor Dictionary: restored
* Requirement Type Router: restored
* Schema Activation Layer: restored
* GapVector Risk Retrieval: restored
* DSL Scoring Engine: restored
* EVPI-lite Clarification Gate: restored

| 模块 | 当前项目状态 | 当前文件 | dsl-v2 来源文件 | 是否缺失 | 是否已迁移 | 测试覆盖 | 备注 |
| -- | ------ | ---- | ----------- | ---- | ----- | ---- | -- |
| Project Skeleton | present | `package.json`, `server/`, `src/`, `e2e/`, `configs/`, `schemas/`, `scripts/`, `reporting/`, `docs/` | `F:\dsl-v2\README.md`, `F:\dsl-v2\asset_manifest.md` | 否 | 不适用 | `npm test`, `npm run smoke` | 当前项目已有 Web/Server/DB/Runner 骨架；本轮补齐 root `schemas/`。 |
| DSL Schema v0 | restored | `schemas/requirement_dsl_v0.schema.json`, `server/services/dslCore/schemaValidator.js`, `e2e/schemas/requirement_dsl.schema.json` | `F:\dsl-v2\core\schemas\requirement_dsl.schema.json` 相关 schema 层 | 部分缺失 | 是 | `server/services/dslCore/dslCore.test.js` | 新增 standalone validator，可拒绝缺 required field。 |
| Risk Factor Dictionary | restored | `configs/dsl/risk_factors.v0.json`, `server/services/dslCore/riskFactorDictionary.js` | `F:\dsl-v2\core\risk_factors\risk_factors.yaml`, `F:\dsl-v2\core\src\risk_engine\risk_factor_loader.py`, `risk_activation.py` | 是 | 是 | `server/services/dslCore/dslCore.test.js` | 迁移为 JS/JSON 规则，覆盖 `test_oracle_unclear`、`error_code_mapping`、`idempotency_contract_missing`、`acceptance_case_missing`、`copy_policy_missing`、`agent_completion_criteria_missing` 等核心因子。 |
| Requirement Type Router | restored | `server/services/dslCore/requirementTypeRouter.js` | `F:\dsl-v2\core\src\router\requirement_type_router.py` | 是 | 是 | `server/services/dslCore/dslCore.test.js` | 支持 UI 样式、收藏交互、登录失败、API、权限、数据、测试、Agent 执行等路由。 |
| Schema Activation Layer | restored | `server/services/dslCore/schemaActivation.js` | `F:\dsl-v2\core\src\router\schema_activation.py` | 是 | 是 | `server/services/dslCore/dslCore.test.js` | 按 category/risk 激活 deep/light modules、required/recommended/blocking fields。 |
| GapVector Risk Retrieval | restored | `server/services/dslCore/gapVector.js` | `F:\dsl-v2\core\src\risk_engine\gap_vector.py` | 是 | 是 | `server/services/dslCore/dslCore.test.js` | 输出 `covered / partial / missing`、`top_gap_factors`、`residual_ratio`。 |
| DSL Scoring Engine | restored | `server/services/dslCore/scoringEngine.js`, `src/adapters/dslArtifactAdapter.js`, `src/components/DSLStatusConsole.jsx` | `F:\dsl-v2\core\src\scoring\dsl_scoring.py`, `dsl_scoring_engine.py` | 部分缺失 | 是 | `server/services/dslCore/dslCore.test.js`, `src/adapters/dslArtifactAdapter.test.js` | 新增真实 `rawScore` 和 breakdown；UI 继续使用 demo `displayScore` clamp 86-94。 |
| EVPI-lite Clarification Gate | restored | `server/services/dslCore/evpiLiteGate.js`, `server/services/skillOrchestrator.js`, `server/services/standaloneArtifactRunner.js` | `F:\dsl-v2\core\src\clarification\evpi_lite.py` | 部分缺失 | 是 | `server/services/dslCore/dslCore.test.js`, `server/server.test.js` | 缺关键验收标准时返回 `clarify_first`，并产出 PM 可回答的问题。 |

### 2. 缺失模块

缺失的独立模块已恢复为当前项目内的 standalone JS/JSON 实现：

* Risk Factor Dictionary
* Requirement Type Router
* Schema Activation Layer
* GapVector Risk Retrieval
* DSL Scoring Engine
* EVPI-lite Clarification Gate

DSL Schema v0 原本存在于 `e2e/schemas/`，但缺少 root `schemas/` 与可直接测试的 JS validator，本轮补齐。

### 3. 从 F:\dsl-v2 迁移的文件 / 逻辑

本轮没有运行时引用 `F:\dsl-v2`，也没有复制 Python runtime。迁移方式为 clean-room JS/JSON 适配：

* `F:\dsl-v2\core\risk_factors\risk_factors.yaml` -> `configs/dsl/risk_factors.v0.json` 与 `server/services/dslCore/riskFactorDictionary.js`
* `F:\dsl-v2\core\src\router\requirement_type_router.py` -> `server/services/dslCore/requirementTypeRouter.js`
* `F:\dsl-v2\core\src\router\schema_activation.py` -> `server/services/dslCore/schemaActivation.js`
* `F:\dsl-v2\core\src\risk_engine\gap_vector.py` -> `server/services/dslCore/gapVector.js`
* `F:\dsl-v2\core\src\scoring\dsl_scoring.py` / `dsl_scoring_engine.py` -> `server/services/dslCore/scoringEngine.js`
* `F:\dsl-v2\core\src\clarification\evpi_lite.py` -> `server/services/dslCore/evpiLiteGate.js`

### 4. 当前项目新增 / 修改文件

新增：

* `schemas/requirement_dsl_v0.schema.json`
* `configs/dsl/risk_factors.v0.json`
* `server/services/dslCore/index.js`
* `server/services/dslCore/schemaValidator.js`
* `server/services/dslCore/riskFactorDictionary.js`
* `server/services/dslCore/requirementTypeRouter.js`
* `server/services/dslCore/schemaActivation.js`
* `server/services/dslCore/gapVector.js`
* `server/services/dslCore/scoringEngine.js`
* `server/services/dslCore/evpiLiteGate.js`
* `server/services/dslCore/dslCore.test.js`
* `scripts/smoke-dsl-core.mjs`
* `reporting/dsl_core_module_audit_report.md`
* `reporting/dsl_core_module_audit_summary.json`

修改：

* `package.json`
* `server/services/skillOrchestrator.js`
* `server/services/standaloneArtifactRunner.js`
* `server/server.test.js`

### 5. 当前 DSL 处理链路

用户输入 -> Requirement Type Router -> Schema Activation Layer -> Risk Factor Dictionary activation -> GapVector Risk Retrieval -> DSL Schema v0 validation -> DSL Scoring Engine -> EVPI-lite Clarification Gate -> `ready_for_agent=false / clarify_first` -> 2-6 个追问问题 -> `rawScore/displayScore` 分离 -> SQLite 持久化 -> 前端展示。

LLM 仍只负责生成 DSL 初稿；规则模块在 mock / dry-run / standalone 环境中可独立测试。

### 6. 测试结果

* npm test: passed, 11 files / 124 tests
* test:server: passed, 5 files / 77 tests
* build: passed
* smoke: passed
* verify: passed, 1920x1080 and 1440x900 no page-level vertical scroll
* check:standalone: passed, `requiresExternalDslV2=false`
* standalone artifacts: passed
* dsl-core smoke: passed

### 7. standalone 确认

* runtime depends on `F:\dsl-v2`: false
* runtime depends on `pm_dsl_runner.py`: false

### 8. 安全检查

* api key leakage: false
* local config committed: false
* local db committed: false
* runs committed: false
* node_modules committed: false
* dist committed: false

### 9. Git / Push

* commit: pending
* pushed: false
* branch: main

### 10. 是否建议返工

不建议返工。8 个 DSL v2 core 能力已经以 standalone JS/JSON 方式补齐并接入当前 Workbench 主链路，且保留豆包 Ark、standalone artifacts runner、SQLite、Agent dry-run、2-6 追问、displayScore 86-94、审计/PR/设计规划页面等现有能力。
