# Commit Report: Audit Preview Workspace Isolation

## 1. Commit 信息

- Commit: `c38030a600e7a2f5746ff2d68c5fece5b5d7562e`
- Message: `fix: isolate audit preview workspace ports`
- Branch pushed: `main`
- Date: 2026-06-11
- Scope: Agent real run, isolated run workspace preview, Review rollback, audit preview port isolation

## 2. 本次提交目的

本次提交解决审计页面与用户本地 Conduit 预览互相干扰的问题。

之前审计页默认复用或启动 `3000` 端口，容易和用户自己打开的 Conduit 前端冲突，导致：

- Agent 跑完后审计页仍展示原始 Conduit，而不是 run workspace 中被 Agent 修改后的页面。
- 用户自己在 `3000` 启动 Conduit 时，Workbench 预览可能误判端口占用或错误复用。
- `Reset Run Workspace` 后，预览没有稳定刷新回 baseline 状态。

本次改动把审计预览改成面向 isolated run workspace 的独立预览链路，默认使用 `3100-3199` 端口池，避免占用用户自己的 `3000`。

## 3. 核心行为变化

### 3.1 审计页优先展示 run workspace

Review Check 页面现在会优先从 Agent Run / activity 中解析：

- `workspacePath`
- `sourceRepoPath`
- `targetRepoPath`

如果存在 run workspace，审计 iframe 展示的是 run workspace 的 Conduit 页面，而不是原始项目路径。

### 3.2 审计预览不再抢占 3000

新增 audit workspace preview 模式：

- 用户本地 Conduit 可继续使用 `3000`
- 审计页 workspace preview 使用 `3100-3199`
- 若端口被占用，允许在 audit 模式下 fallback 到下一个可用端口
- toolbar 同时展示用户 Conduit 入口和当前审计预览 URL

### 3.3 workspace 预览可以借用原项目依赖

run workspace 通常不复制 `node_modules`。为了让 workspace 内的 Conduit 前端能启动，preview launcher 会：

- 使用 source repo 的 Vite binary
- 尝试把 source repo 的 `node_modules` / `frontend/node_modules` 作为 junction/symlink 链接到 workspace
- 不修改原始 Conduit 源码

### 3.4 回退后刷新审计预览

文件回退或整次 reset 后：

- changed files 重新加载
- diff 重新加载
- iframe preview key 更新，触发页面重新载入
- verification 标记为 stale

### 3.5 Reset 保留必要目录

run workspace reset 时不再粗暴删除整个 workspace，而是保留：

- `.git`
- `node_modules`
- `frontend/node_modules`

这样 reset 后 workspace 仍可继续作为可运行预览环境。

## 4. 修改文件

- `agent(2)/agent/agent_core/agents/coder_agent.py`
- `agent(2)/agent/agent_core/interfaces/repo_adapter.py`
- `server/services/agent2Adapter.js`
- `server/services/persistence/workbenchPersistenceAdapter.js`
- `server/services/previewLauncherService.js`
- `server/services/rollbackService.js`
- `server/services/workspaceAdapter.js`
- `src/components/AgentWorkMatrix.jsx`
- `src/components/DesignPlanningWorkbench.jsx`
- `src/components/ReviewCheckWorkbench.jsx`
- `src/data/agentWorkflowData.js`
- `src/styles.css`

统计：12 个文件，约 915 行新增，99 行删除。

## 5. 后端改动说明

### `previewLauncherService.js`

- 新增 audit preview 端口池：`3100-3199`
- 支持 `previewMode: "audit_workspace"`
- 支持 `allowPortFallback`
- 支持 `dependencyPath/sourceRepoPath`
- 支持 workspace 借用 source repo 的依赖目录
- `startPreview/status/stopPreview` 统一使用带 config/deps 的 context preparation

### `rollbackService.js`

- 当 `file_change_records` 缺失但 baseline snapshot 存在时，自动扫描 workspace 与 baseline 差异并补齐变更记录。
- 解决旧 run 或记录缺失时审计页没有 changed files / diff 的问题。

### `workspaceAdapter.js`

- reset workspace 时改为 prune 文件树，而不是删除整个 workspace 根目录。
- 保留 `.git`、`node_modules`、`frontend/node_modules`，保证 reset 后预览仍能启动。

### `workbenchPersistenceAdapter.js`

- 调整持久化字段映射，确保 run workspace / verification 相关状态可被前端读取。

### `agent2Adapter.js`

- 调整 Agent2 调用和 run context 输出，使真实 run 后 workspace 信息能进入后续 Review 链路。

## 6. Agent 侧改动说明

### `coder_agent.py`

- 增强 fallback 生成逻辑，避免空内容覆盖文件。
- 对 Conduit 黑红主题测试任务提供更具体的 CSS fallback 修改。
- 提升真实写入失败时的可观测性，减少“看起来跑了但没有改动”的情况。

### `repo_adapter.py`

- 调整 repo 写入接口行为，使 Agent 修改目标稳定指向 run workspace。
- 避免把操作误导到原始 repo。

## 7. 前端改动说明

### `ReviewCheckWorkbench.jsx`

- Review 页面自动解析最新 run workspace。
- 通过 project activity 查找当前 requirement 的最新 Agent Run。
- iframe 预览优先使用 workspace preview。
- 回退 / reset 后刷新 diff、changed files 和 iframe。
- toolbar 增加用户 Conduit 与审计 preview 的区分展示。

### `DesignPlanningWorkbench.jsx`

- 调整 Agent 执行区域文案和布局，突出真实运行状态与审计入口。
- 压缩部分运行矩阵信息，避免挡住关键执行摘要和按钮。

### `AgentWorkMatrix.jsx`

- 缩减展示信息，避免 Agent 运行控制区被矩阵挤压。

### `agentWorkflowData.js`

- 补充 workspace / source repo 相关字段，使前端默认 workflow 数据结构能承接真实 run 信息。

### `styles.css`

- 增加审计预览、rollback、Agent 运行区域相关样式。
- 优化按钮、面板、状态提示、diff/rollback 区域布局。

## 8. 当前端口策略

- 用户独立 Conduit frontend：默认 `http://127.0.0.1:3000`
- Conduit backend：默认 `http://127.0.0.1:3001`
- Workbench frontend：默认 `http://127.0.0.1:9999`
- Workbench backend：默认 `http://127.0.0.1:8787`
- 审计 workspace preview：默认 `http://127.0.0.1:3100`，必要时使用 `3101-3199`

这样用户可以保留自己手动启动的 Conduit，同时审计页展示 Agent run workspace 中的真实修改结果。

## 9. 已验证内容

- `npm run build`：通过
- `node --check server/services/previewLauncherService.js`：通过
- `node --check server/services/workspaceAdapter.js`：通过
- 审计 iframe 可打开 workspace preview：`http://127.0.0.1:3100/#/login`
- `3100/api/tags` 可代理到 Conduit backend `3001`
- 通过 `3100/api/users/login` 验证真实 Conduit 登录 API 可用

## 10. 未纳入本次提交的内容

本次提交只包含审计预览、run workspace、rollback、real agent 相关改动。

以下本地文件保持未提交：

- PR Draft Center 相关改动
- DSLStatusConsole 相关改动
- reporting 中的其它报告文件
- `agent(2)` 下的 `__pycache__/*.pyc`
- 其它未暂存的队友或本地工作区改动

## 11. 对接注意事项

1. 审计页现在看到的 Conduit 页面应来自 run workspace，而不是原始 Conduit repo。
2. 如果用户自己启动了 `3000`，不应影响审计页；审计页会使用 `3100-3199`。
3. Reset Run Workspace 只回退 run workspace，不会直接修改原始 Conduit 仓库。
4. Reset 后 preview 应重新加载，展示 baseline 状态。
5. 如果旧 run 没有 baseline snapshot，rollback API 仍应返回不可回退状态。

## 12. 后续建议

- 补充一组端到端测试：真实 Agent run -> Review preview -> file revert -> reset workspace -> preview reload。
- 给 preview toolbar 增加更明显的“用户 Conduit / 审计 workspace”标签。
- 将 audit preview 端口范围暴露到配置页或环境变量说明文档中。
- 对 `agent(2)` 下的 Python 缓存文件增加 `.gitignore` 规则，避免后续误提交。
