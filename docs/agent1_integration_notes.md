## Agent(1) Workbench Integration Notes

### Source Inspected

- External source directory: `F:\字节比赛\最终程序\agent(1)`
- The directory is treated as user-provided reference material.
- The raw `agent(1)` tree is ignored by git and is not copied into the product source.

### Inventory Findings

- `agent(1)` contains a Python Agent Runtime under `agent\agent_core`.
- It also contains a Node Context Service handoff package under `agent\context-service-handoff`.
- Python CLI entrypoint: `agent/agent_core/main.py`.
- The agent runtime can select skills, locate files, generate patch previews, review patches, execute patches, and verify results.
- Runtime configuration references include `AGENT_REPO_MODE`, `AGENT_REPO_ROOT`, `AGENT_REPO_APPLY`, `AGENT_REPO_CONFIRM`, `DOUBAO_API_KEY`, and `DOUBAO_ENDPOINT`.

### Integration Decision

The current workbench integration uses a safe preview adapter instead of invoking the Python writer directly.

Reasons:

- Real repo modification paths exist in `agent(1)`.
- A future real-write path would require clean target repo checks, explicit human confirmation, and careful handling of user changes.
- The current product requirement is a workbench orchestration MVP, not a production handoff into code execution.

### Backend API Mapping

- `GET /api/agent/inventory`: inspects `agent(1)` and writes inventory reports.
- `POST /api/agent/readiness`: returns dry-run readiness and safety boundaries.
- `POST /api/agent/run`: creates dry-run-only plan, review, PR draft, and artifacts.
- `GET /api/agent/runs/:runId`: reads in-memory run status.
- `POST /api/agent/runs/:runId/cancel`: cancels a non-completed in-memory run.
- `GET /api/agent/runs/:runId/artifacts`: returns dry-run artifacts for review and PR pages.

### Frontend Flow

- Design Planning page exposes the Agent entry.
- `查看 Agent 输入 Context` previews the dry-run context.
- `仅生成执行计划` and `开始执行当前任务` both route to dry-run plan generation.
- Review Check page displays changed files, reasons, requirement mapping, risks, tests, and manual confirmations.
- PR Page displays PR title, summary, changed files, tests, risks, checklist, and copyable PR description.

### Safety Boundaries

- Default mode is dry-run.
- Real writes are blocked in `/api/agent/run` when `dryRun: false`.
- The integration does not set `AGENT_REPO_CONFIRM=YES`.
- The integration does not call hunter, auto-reply, A3B, or Agent Handoff.
- The integration does not modify `F:\dsl` or `F:\dsl-v2`.
- API keys and local config files are not emitted to UI reports.

### Future Real-Write Requirements

Before any future real agent execution path:

- Require explicit human confirmation in the UI.
- Check target repo status and protect uncommitted user changes.
- Record exact files written.
- Run verification commands and attach results.
- Keep secret scanning before commit/push.
