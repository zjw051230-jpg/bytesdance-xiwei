## Standalone Dependency Inventory

### Scope
- Target directory: `F:\字节比赛\最终程序`
- Goal: allow real E2E dry-run from the final program repo without requiring `F:\dsl-v2`
- Required local config template: `configs/api_config.template.json`
- Required local runtime assets: `e2e/`

### Before Consolidation
- Server defaults referenced the external DSL runtime/config under `F:\dsl-v2`.
- Skill prompt loading expected external runtime prompt folders.
- Web UI code context default pointed to the external DSL v2 context packet.
- Real E2E runner assets were not packaged inside the final program repo.

### After Consolidation
- API config default is project-local `configs/api_config.local.json`.
- `configs/api_config.local.json` is ignored and must be created by each teammate from `configs/api_config.template.json`.
- Server and skill defaults use project-local `e2e/` prompt/context assets.
- Standalone dry-run script is available through `npm run smoke:e2e-real:dry-run`.
- `npm run check:standalone` verifies required files, scripts, ignore rules, and reports no required external `F:\dsl-v2` dependency.

### Remaining External Compatibility
- Source keeps no required external `F:\dsl-v2` dependency according to `check:standalone`.
- Compatibility fallback constants may exist only to warn users when older local environments still have an external config available.
- The standalone dry-run command disables external fallback and requires project-local config.

### Ignored Runtime Outputs
- `configs/api_config.local.json`
- `runs/`
- `dist/`
- `node_modules/`
- `.env`, `.env.*`, `*.local.json`, `*.log`

### Verification
- `npm run check:standalone`: passed
- `npm run smoke:e2e-real:dry-run`: passed with `configSource=project_local`, `realLlmCalls=3`, `realWritePerformed=false`
