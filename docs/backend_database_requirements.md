# Backend / Database Requirements for Codex Workbench

This document describes what the backend and database layer needs to support for Codex Workbench collaboration. It is an API and data requirement document only. It does not prescribe implementation technology, storage engine, schema-change plan, table design, or runtime stack.

## 1. 项目目标

Codex Workbench 需要把 PM 需求从 DSL 澄清、设计规划、Agent 执行、审阅检查，到 PR 交付形成一条可追踪的工作流。

The backend needs to support these product capabilities:

- 项目管理: list, create, select, update, and summarize workbench projects.
- 需求 / DSL 草稿: capture PM requirements, generated DSL drafts, readiness, risk, and report status.
- 设计规划: store plan summaries, milestones, task breakdown, blockers, progress, and next actions.
- 任务拆解: create and update planning tasks that map product requirements to execution steps.
- Agent run: track dry-run and future execution metadata, status, artifacts, progress, and cancellation.
- 审阅检查: store agent-proposed file changes, requirement mapping, risk notes, test results, and manual review decisions.
- PR 草稿: store PR title, summary, files, tests, risks, checklist, and readiness state.
- 报告与 artifact: index human-readable reports and generated artifacts without forcing large payloads into primary records.
- 运行状态: expose run status and latest events for long-running work.
- 用户可见历史记录: provide activity history for projects, requirements, runs, reports, reviews, and PR drafts.

## 2. 核心业务对象

### Project

- 对象用途: a workspace project selected from the workbench home and project rail.
- 关键字段: `id`, `name`, `description`, `localPathLabel`, `status`, `icon`, `owner`, `branch`, `lastOpenedAt`, `updatedAt`, `createdAt`.
- 是否需要持久化: yes.
- 生命周期: created by user or seeded by system; remains visible until archived or deleted.
- 与其他对象关系: owns requirements, design plans, runs, reports, artifacts, and activity logs.

### Requirement / DSL Draft

- 对象用途: the PM requirement and current DSL candidate shown in the DSL clarification workbench.
- 关键字段: `id`, `projectId`, `title`, `goal`, `status`, `dslDraft`, `dslCompletion`, `readiness`, `handoffDecision`, `coverageItems`, `risks`, `pendingConfirmations`, `sourceMode`, `createdAt`, `updatedAt`.
- 是否需要持久化: yes.
- 生命周期: created from PM input; updated after clarification turns, DSL runs, skill turns, or report edits; can later become archived.
- 与其他对象关系: belongs to one project; owns clarification turns, design plan, reports, agent runs, and PR draft.

### Clarification Turn

- 对象用途: a PM or system clarification message in the DSL workbench.
- 关键字段: `id`, `requirementId`, `role`, `authorLabel`, `content`, `questionKey`, `source`, `createdAt`, `sequence`.
- 是否需要持久化: yes.
- 生命周期: appended during clarification; should be immutable except for moderation or redaction metadata.
- 与其他对象关系: belongs to a requirement; can trigger updates to DSL draft, readiness, report, and recommended question state.

### Design Plan

- 对象用途: design planning state for a clarified requirement.
- 关键字段: `id`, `requirementId`, `title`, `goal`, `status`, `currentStage`, `owner`, `roles`, `completion`, `milestones`, `blockers`, `watchedRisks`, `nextActions`, `latestFeedback`, `updatedAt`.
- 是否需要持久化: yes.
- 生命周期: created after requirement reaches planning stage; updated as tasks progress and feedback is recorded.
- 与其他对象关系: belongs to one requirement; owns planning tasks and can link to agent runs.

### Planning Task

- 对象用途: one task in the design planning breakdown.
- 关键字段: `id`, `planId`, `title`, `owner`, `status`, `dueDate`, `priority`, `description`, `blockedReason`, `updatedAt`.
- 是否需要持久化: yes.
- 生命周期: created from plan; updated through `todo`, `running`, `blocked`, `done`, or review states.
- 与其他对象关系: belongs to a design plan; may be referenced by agent run context and review items.

### Agent Run

- 对象用途: a tracked Agent dry-run or future confirmed execution attempt.
- 关键字段: `id`, `projectId`, `requirementId`, `planId`, `taskTitle`, `mode`, `dryRun`, `status`, `latestReturn`, `realWritePerformed`, `startedAt`, `finishedAt`, `cancelledAt`, `error`, `outputRef`.
- 是否需要持久化: yes for run metadata and status; large details can be referenced as artifacts.
- 生命周期: created when user starts an agent run; progresses from queued/running to terminal status; can be cancelled.
- 与其他对象关系: belongs to project and usually requirement; produces agent artifacts, review items, events, and PR draft updates.

### Agent Artifact

- 对象用途: generated context, plan preview, review payload, PR draft payload, logs, screenshots, patch previews, and test logs.
- 关键字段: `id`, `runId`, `projectId`, `requirementId`, `type`, `name`, `contentRef`, `contentPreview`, `mimeType`, `size`, `hash`, `createdAt`, `redactionState`.
- 是否需要持久化: yes as an index and retrievable reference; large content may be stored outside the primary record.
- 生命周期: created during run or report generation; retained for audit and user review.
- 与其他对象关系: belongs to agent run or report; can feed review and PR pages.

### Review Item

- 对象用途: one human review row for an agent-proposed change or risk.
- 关键字段: `id`, `runId`, `filePath`, `changeSummary`, `why`, `requirementPoint`, `risk`, `testStatus`, `status`, `reviewer`, `commentCount`, `updatedAt`.
- 是否需要持久化: yes.
- 生命周期: created from agent review output; updated by human review; may block PR readiness.
- 与其他对象关系: belongs to agent run; can have comments; can be summarized in PR draft.

### Pull Request Draft

- 对象用途: a user-visible PR preparation object, not a remote PR creation command.
- 关键字段: `id`, `requirementId`, `runId`, `title`, `summary`, `changedFiles`, `tests`, `risks`, `checklist`, `status`, `copiedAt`, `updatedAt`.
- 是否需要持久化: yes.
- 生命周期: generated after review data exists; updated until ready or archived.
- 与其他对象关系: belongs to requirement and may reference agent run; depends on review items and artifacts.

### Report

- 对象用途: human-readable requirement, run, quality, and integration reports.
- 关键字段: `id`, `projectId`, `requirementId`, `runId`, `type`, `title`, `status`, `summary`, `contentRef`, `generatedAt`, `updatedAt`, `authorLabel`.
- 是否需要持久化: yes as report index and current visible content reference.
- 生命周期: generated by DSL, skill, smoke, or agent flows; can be opened from status console or monitor views.
- 与其他对象关系: belongs to project and optionally requirement/run; may reference artifacts.

### Run Event / Activity Log

- 对象用途: user-visible event history for project, requirement, run, report, review, and PR actions.
- 关键字段: `id`, `projectId`, `subjectType`, `subjectId`, `eventType`, `title`, `message`, `actorLabel`, `severity`, `createdAt`, `metadata`.
- 是否需要持久化: yes.
- 生命周期: appended for important state changes and user actions; generally immutable.
- 与其他对象关系: linked to project and a subject object.

## 3. 页面与后端能力映射

### 3.1 项目选择页

Needs backend support for:

- Project list with current status, recent update time, rail subtitle, and display icon.
- New project creation from name and local path label.
- Active project selection and last-opened timestamp update.
- Project status summary for project rail and workbench home.

### 3.2 DSL 澄清页

Needs backend support for:

- Persisting PM messages and system clarification messages in order.
- Persisting current DSL draft, DSL completion score, readiness state, and handoff decision.
- Persisting risks, coverage items, pending confirmations, and recommended clarification question metadata.
- Starting and reading DSL run status and artifacts.
- Storing the human-readable requirement report that opens from the DSL status console.

### 3.3 设计规划页

Needs backend support for:

- Reading and saving design plan summary, milestones, status, current stage, owner, roles, and progress.
- Reading, creating, and updating planning tasks.
- Recording execution feedback and latest Codex / Agent return summary.
- Displaying blockers, watched risks, and next action recommendations.
- Starting Agent dry-run context preview and run tracking from the plan.

### 3.4 审阅检查页

Needs backend support for:

- Reading agent-proposed changed files and change summaries.
- Displaying why each file is affected and which requirement point it maps to.
- Displaying risks, planned/executed tests, and manual confirmations.
- Recording human review status, comments, and rework-needed issues.
- Blocking PR readiness until required review items are resolved.

### 3.5 PR 页面

Needs backend support for:

- Generating or saving PR draft content from requirement, agent run, and review data.
- Reading change summary, changed files, test status, risks, and checklist.
- Updating PR draft readiness and checklist state.
- Recording that the PR description was copied.
- Keeping this as a draft object unless a later task explicitly adds remote PR creation.

## 4. API 接口说明

All responses should use the envelope described in section 5. The request and response shapes below are contracts for frontend/backend coordination only.

### Project APIs

#### GET /api/projects

- Method: `GET`
- Path: `/api/projects`
- 用途: list projects for workbench home and project rail.
- 请求参数: optional `status`, `search`, `limit`, `cursor`.
- 请求 body: none.
- 响应 body: `{ "projects": [ProjectSummary], "page": { "nextCursor": "string|null" } }`
- 错误码: `bad_request`, `permission_denied`
- 备注: project summary should include `id`, `name`, `description`, `status`, `icon`, `lastOpenedAt`, `updatedAt`.

#### POST /api/projects

- Method: `POST`
- Path: `/api/projects`
- 用途: create a new workbench project record.
- 请求参数: none.
- 请求 body: `{ "name": "string", "description": "string?", "localPathLabel": "string?", "icon": "string?" }`
- 响应 body: `{ "project": Project }`
- 错误码: `bad_request`, `validation_failed`, `permission_denied`
- 备注: local path labels should be treated as display metadata and should not expose sensitive path segments unnecessarily.

#### GET /api/projects/:projectId

- Method: `GET`
- Path: `/api/projects/:projectId`
- 用途: read project detail for current workbench context.
- 请求参数: `projectId`.
- 请求 body: none.
- 响应 body: `{ "project": Project, "summary": ProjectSummaryMetrics }`
- 错误码: `project_not_found`, `permission_denied`
- 备注: summary can include latest requirement, latest run, report counts, and activity counts.

#### PATCH /api/projects/:projectId

- Method: `PATCH`
- Path: `/api/projects/:projectId`
- 用途: update project display metadata, selection state, or archive state.
- 请求参数: `projectId`.
- 请求 body: partial `{ "name": "string?", "description": "string?", "status": "string?", "lastOpenedAt": "datetime?" }`
- 响应 body: `{ "project": Project }`
- 错误码: `bad_request`, `validation_failed`, `project_not_found`, `permission_denied`
- 备注: should be partial update; unknown fields should be rejected or ignored consistently.

### Requirement / DSL APIs

#### GET /api/projects/:projectId/requirements

- Method: `GET`
- Path: `/api/projects/:projectId/requirements`
- 用途: list requirements under a project.
- 请求参数: `projectId`, optional `status`, `limit`, `cursor`.
- 请求 body: none.
- 响应 body: `{ "requirements": [RequirementSummary], "page": { "nextCursor": "string|null" } }`
- 错误码: `project_not_found`, `permission_denied`
- 备注: summaries should include current DSL readiness and latest update time.

#### POST /api/projects/:projectId/requirements

- Method: `POST`
- Path: `/api/projects/:projectId/requirements`
- 用途: create a requirement from PM input.
- 请求参数: `projectId`.
- 请求 body: `{ "title": "string", "pmText": "string", "source": "manual|imported|skill_turn" }`
- 响应 body: `{ "requirement": Requirement, "firstClarificationTurn": ClarificationTurn? }`
- 错误码: `bad_request`, `validation_failed`, `project_not_found`
- 备注: PM input should be stored as part of requirement history.

#### GET /api/requirements/:requirementId

- Method: `GET`
- Path: `/api/requirements/:requirementId`
- 用途: read requirement detail and current DSL state.
- 请求参数: `requirementId`.
- 请求 body: none.
- 响应 body: `{ "requirement": Requirement, "dsl": DslState, "readiness": ReadinessState }`
- 错误码: `requirement_not_found`, `permission_denied`
- 备注: used by DSL workbench, design planning, and PR page context.

#### PATCH /api/requirements/:requirementId

- Method: `PATCH`
- Path: `/api/requirements/:requirementId`
- 用途: update title, status, DSL draft, readiness, risks, pending confirmations, or report reference.
- 请求参数: `requirementId`.
- 请求 body: partial requirement fields.
- 响应 body: `{ "requirement": Requirement }`
- 错误码: `bad_request`, `validation_failed`, `requirement_not_found`, `dsl_not_ready`
- 备注: updates that move readiness toward execution should preserve audit history.

#### GET /api/requirements/:requirementId/report

- Method: `GET`
- Path: `/api/requirements/:requirementId/report`
- 用途: read human-readable requirement report for the report modal.
- 请求参数: `requirementId`.
- 请求 body: none.
- 响应 body: `{ "report": Report, "sections": RequirementReportSections }`
- 错误码: `requirement_not_found`, `not_found`, `permission_denied`
- 备注: report content must be safe for frontend display.

### Clarification APIs

#### GET /api/requirements/:requirementId/clarifications

- Method: `GET`
- Path: `/api/requirements/:requirementId/clarifications`
- 用途: read ordered PM/system clarification history.
- 请求参数: `requirementId`, optional `after`, `limit`.
- 请求 body: none.
- 响应 body: `{ "turns": [ClarificationTurn], "page": { "nextCursor": "string|null" } }`
- 错误码: `requirement_not_found`, `permission_denied`
- 备注: order should be stable for replaying the conversation.

#### POST /api/requirements/:requirementId/clarifications

- Method: `POST`
- Path: `/api/requirements/:requirementId/clarifications`
- 用途: append a PM answer or system clarification turn.
- 请求参数: `requirementId`.
- 请求 body: `{ "role": "pm|system", "content": "string", "questionKey": "string?", "source": "manual|skill|system" }`
- 响应 body: `{ "turn": ClarificationTurn, "requirement": Requirement? }`
- 错误码: `bad_request`, `validation_failed`, `requirement_not_found`
- 备注: response may include updated requirement state if the turn changes DSL readiness.

### Design Planning APIs

#### GET /api/requirements/:requirementId/design-plan

- Method: `GET`
- Path: `/api/requirements/:requirementId/design-plan`
- 用途: read design plan for a requirement.
- 请求参数: `requirementId`.
- 请求 body: none.
- 响应 body: `{ "designPlan": DesignPlan|null }`
- 错误码: `requirement_not_found`, `permission_denied`
- 备注: returns null when no plan exists yet.

#### POST /api/requirements/:requirementId/design-plan

- Method: `POST`
- Path: `/api/requirements/:requirementId/design-plan`
- 用途: create design plan.
- 请求参数: `requirementId`.
- 请求 body: `{ "title": "string", "goal": "string", "milestones": [Milestone]?, "roles": ["string"]? }`
- 响应 body: `{ "designPlan": DesignPlan }`
- 错误码: `bad_request`, `validation_failed`, `requirement_not_found`, `dsl_not_ready`
- 备注: if requirement is not ready for planning, backend should return a clear business error.

#### PATCH /api/design-plans/:planId

- Method: `PATCH`
- Path: `/api/design-plans/:planId`
- 用途: update plan status, stage, progress, blockers, risks, or next actions.
- 请求参数: `planId`.
- 请求 body: partial design plan fields.
- 响应 body: `{ "designPlan": DesignPlan }`
- 错误码: `bad_request`, `validation_failed`, `not_found`
- 备注: progress and blockers should remain visible on the design planning page.

#### GET /api/design-plans/:planId/tasks

- Method: `GET`
- Path: `/api/design-plans/:planId/tasks`
- 用途: list planning tasks.
- 请求参数: `planId`.
- 请求 body: none.
- 响应 body: `{ "tasks": [PlanningTask] }`
- 错误码: `not_found`, `permission_denied`
- 备注: used by the task breakdown table.

#### POST /api/design-plans/:planId/tasks

- Method: `POST`
- Path: `/api/design-plans/:planId/tasks`
- 用途: create a planning task.
- 请求参数: `planId`.
- 请求 body: `{ "title": "string", "owner": "string", "status": "string?", "dueDate": "date?", "priority": "string?" }`
- 响应 body: `{ "task": PlanningTask }`
- 错误码: `bad_request`, `validation_failed`, `not_found`
- 备注: should create activity log entry.

#### PATCH /api/planning-tasks/:taskId

- Method: `PATCH`
- Path: `/api/planning-tasks/:taskId`
- 用途: update planning task state and metadata.
- 请求参数: `taskId`.
- 请求 body: partial planning task fields.
- 响应 body: `{ "task": PlanningTask }`
- 错误码: `bad_request`, `validation_failed`, `not_found`
- 备注: blocked tasks should include a user-visible reason when available.

### Agent Run APIs

#### POST /api/agent/runs

- Method: `POST`
- Path: `/api/agent/runs`
- 用途: start or register an Agent run for a requirement or plan.
- 请求参数: none.
- 请求 body: `{ "projectId": "string", "requirementId": "string?", "planId": "string?", "taskTitle": "string", "dryRun": true, "context": {} }`
- 响应 body: `{ "run": AgentRun, "artifacts": [AgentArtifactSummary]? }`
- 错误码: `bad_request`, `validation_failed`, `project_not_found`, `requirement_not_found`, `dsl_not_ready`, `permission_denied`
- 备注: default must be dry-run. Future real write modes require explicit user confirmation and separate safety state.

#### GET /api/agent/runs/:runId

- Method: `GET`
- Path: `/api/agent/runs/:runId`
- 用途: read Agent run status and latest return.
- 请求参数: `runId`.
- 请求 body: none.
- 响应 body: `{ "run": AgentRun }`
- 错误码: `not_found`, `permission_denied`
- 备注: used by progress panels and review/PR pages.

#### POST /api/agent/runs/:runId/cancel

- Method: `POST`
- Path: `/api/agent/runs/:runId/cancel`
- 用途: request cancellation of a queued or running Agent run.
- 请求参数: `runId`.
- 请求 body: `{ "reason": "string?" }`
- 响应 body: `{ "run": AgentRun }`
- 错误码: `not_found`, `agent_run_cancelled`, `permission_denied`
- 备注: completed runs should not be changed except for returning current terminal state.

#### GET /api/agent/runs/:runId/artifacts

- Method: `GET`
- Path: `/api/agent/runs/:runId/artifacts`
- 用途: list artifacts generated by an Agent run.
- 请求参数: `runId`.
- 请求 body: none.
- 响应 body: `{ "runId": "string", "artifacts": [AgentArtifactSummary] }`
- 错误码: `not_found`, `artifact_missing`, `permission_denied`
- 备注: large artifacts can be returned as references plus previews.

#### GET /api/agent/runs/:runId/events

- Method: `GET`
- Path: `/api/agent/runs/:runId/events`
- 用途: read run progress events for timelines or live panels.
- 请求参数: `runId`, optional `after`, `limit`.
- 请求 body: none.
- 响应 body: `{ "events": [RunEvent], "page": { "nextCursor": "string|null" } }`
- 错误码: `not_found`, `permission_denied`
- 备注: event stream should be append-only from the frontend perspective.

### Review APIs

#### GET /api/agent/runs/:runId/review

- Method: `GET`
- Path: `/api/agent/runs/:runId/review`
- 用途: read review items and summary for Review Check page.
- 请求参数: `runId`.
- 请求 body: none.
- 响应 body: `{ "review": { "status": "string", "summary": "string", "items": [ReviewItem], "tests": [TestResult], "manualConfirmations": ["string"] } }`
- 错误码: `not_found`, `artifact_missing`, `permission_denied`
- 备注: if review data is not generated, return clear missing or pending state.

#### PATCH /api/review-items/:reviewItemId

- Method: `PATCH`
- Path: `/api/review-items/:reviewItemId`
- 用途: update human review status for one item.
- 请求参数: `reviewItemId`.
- 请求 body: `{ "status": "pending|approved|changes_requested|blocked|resolved", "reviewer": "string?", "risk": "string?" }`
- 响应 body: `{ "reviewItem": ReviewItem }`
- 错误码: `bad_request`, `validation_failed`, `not_found`, `review_blocked`
- 备注: status changes should affect PR readiness.

#### POST /api/review-items/:reviewItemId/comments

- Method: `POST`
- Path: `/api/review-items/:reviewItemId/comments`
- 用途: add a review comment or rework note.
- 请求参数: `reviewItemId`.
- 请求 body: `{ "content": "string", "authorLabel": "string?", "type": "comment|rework|confirmation" }`
- 响应 body: `{ "comment": ReviewComment, "reviewItem": ReviewItem }`
- 错误码: `bad_request`, `validation_failed`, `not_found`
- 备注: comments should be visible in activity history when important.

### PR APIs

#### GET /api/requirements/:requirementId/pr-draft

- Method: `GET`
- Path: `/api/requirements/:requirementId/pr-draft`
- 用途: read PR draft for a requirement.
- 请求参数: `requirementId`.
- 请求 body: none.
- 响应 body: `{ "prDraft": PullRequestDraft|null }`
- 错误码: `requirement_not_found`, `permission_denied`
- 备注: returns null if no PR draft exists yet.

#### POST /api/requirements/:requirementId/pr-draft

- Method: `POST`
- Path: `/api/requirements/:requirementId/pr-draft`
- 用途: create or regenerate PR draft content.
- 请求参数: `requirementId`.
- 请求 body: `{ "runId": "string?", "title": "string?", "summary": ["string"]?, "changedFiles": ["string"]?, "tests": [TestResult]?, "risks": ["string"]?, "checklist": ["string"]? }`
- 响应 body: `{ "prDraft": PullRequestDraft }`
- 错误码: `bad_request`, `validation_failed`, `requirement_not_found`, `review_blocked`, `pr_not_ready`
- 备注: remote PR creation is out of scope; this endpoint stores draft content only.

#### PATCH /api/pr-drafts/:prDraftId

- Method: `PATCH`
- Path: `/api/pr-drafts/:prDraftId`
- 用途: update PR draft status, checklist, title, summary, or copied timestamp.
- 请求参数: `prDraftId`.
- 请求 body: partial PR draft fields.
- 响应 body: `{ "prDraft": PullRequestDraft }`
- 错误码: `bad_request`, `validation_failed`, `not_found`, `pr_not_ready`
- 备注: backend should prevent ready state when blocking review items remain.

### Report / Artifact APIs

#### GET /api/reports/:reportId

- Method: `GET`
- Path: `/api/reports/:reportId`
- 用途: read a report by id.
- 请求参数: `reportId`.
- 请求 body: none.
- 响应 body: `{ "report": Report }`
- 错误码: `not_found`, `permission_denied`
- 备注: report body should be safe for frontend display.

#### GET /api/artifacts/:artifactId

- Method: `GET`
- Path: `/api/artifacts/:artifactId`
- 用途: read artifact metadata and optionally content preview.
- 请求参数: `artifactId`, optional `includeContentPreview`.
- 请求 body: none.
- 响应 body: `{ "artifact": AgentArtifact, "content": "string|object|null" }`
- 错误码: `not_found`, `artifact_missing`, `permission_denied`, `secret_redacted`
- 备注: large content can require explicit preview or download behavior in a future task.

#### GET /api/projects/:projectId/activity

- Method: `GET`
- Path: `/api/projects/:projectId/activity`
- 用途: read project activity history.
- 请求参数: `projectId`, optional `subjectType`, `limit`, `cursor`.
- 请求 body: none.
- 响应 body: `{ "events": [RunEvent], "page": { "nextCursor": "string|null" } }`
- 错误码: `project_not_found`, `permission_denied`
- 备注: used by monitor console, timelines, and user-visible history.

## 5. 推荐响应格式

Success envelope:

```json
{
  "ok": true,
  "data": {},
  "error": null
}
```

Error envelope:

```json
{
  "ok": false,
  "data": null,
  "error": {
    "code": "string",
    "message": "string",
    "details": {}
  }
}
```

Recommended HTTP status usage:

- `200`: request succeeded.
- `201`: resource created.
- `202`: long-running job accepted.
- `400`: invalid request shape or unsupported state transition.
- `403`: user is not allowed to perform the action.
- `404`: referenced object was not found.
- `409`: conflicting state, such as blocked review or PR not ready.
- `422`: validation failed.
- `500`: unexpected backend failure.
- `503`: dependent service is unavailable.

## 6. 状态枚举

### project.status

- `active`: project is selectable and visible.
- `current`: project is currently selected or recently active.
- `pass`: latest checks passed.
- `warn`: project has warnings.
- `fail`: project has failing runs or blocked state.
- `archived`: hidden from default list but retained.

### requirement.status

- `draft`: initial PM input captured.
- `clarifying`: clarification is still ongoing.
- `dsl_ready`: DSL candidate exists.
- `planning`: design planning has started.
- `agent_ready`: eligible for dry-run or confirmed execution flow.
- `reviewing`: review is in progress.
- `pr_drafting`: PR draft is being prepared.
- `completed`: workflow is complete.
- `archived`: no longer active.

### dsl.readiness

- `not_ready`: insufficient clarity.
- `clarify_first`: more PM confirmation is needed.
- `ready_for_planning`: can move into design planning.
- `ready_for_agent`: eligible for agent run after safety checks.
- `blocked`: cannot proceed until risks are resolved.

### planningTask.status

- `todo`
- `running`
- `blocked`
- `done`
- `needs_review`
- `cancelled`

### agentRun.status

- `queued`
- `running`
- `completed`
- `failed`
- `timeout`
- `cancelled`

### reviewItem.status

- `pending`
- `approved`
- `changes_requested`
- `blocked`
- `resolved`

### prDraft.status

- `draft`
- `blocked`
- `ready`
- `copied`
- `archived`

### artifact.type

- `dsl_input`
- `dsl_output`
- `agent_context`
- `agent_plan`
- `agent_review`
- `pr_draft`
- `report`
- `screenshot`
- `log`
- `test_result`
- `patch_preview`

## 7. 数据持久化要求

### 必须持久化

- Projects.
- Requirements and DSL draft state.
- Clarification history.
- Design plans.
- Planning tasks.
- Agent run metadata and final status.
- Review items, comments, and decisions.
- PR draft content and checklist.
- Report index and current report references.
- Activity logs and important run events.

### 可以只保存文件或对象存储引用

- Large artifacts.
- Screenshots.
- Complete process output logs.
- Complete model raw responses.
- Generated patch previews.
- Test logs.
- Render verification JSON.

### 不应持久化明文

- Third-party service secrets.
- Raw authentication header values.
- Raw access tokens.
- `.env` file content.
- Sensitive local absolute paths. Store safe labels or redacted forms when the UI needs to display a path-like value.

## 8. 权限与安全边界

The backend needs to support these safety capabilities:

- Sensitive fields must be redacted before persistence or frontend response.
- Service secrets must not be stored as normal business data.
- Local configuration content must not be returned to the frontend.
- Run outputs and artifact previews must be redacted before user-visible display.
- Real file writes require explicit user confirmation and a recorded safety decision.
- Dry-run should be the default execution mode.
- PR draft cannot become ready while required review items are unresolved.
- Agent execution must be blocked when `ready_for_agent` is false.
- User-visible local path values should be treated as potentially sensitive and minimized.
- Activity history should record safety-relevant state transitions.

This section describes required capabilities only and does not prescribe security implementation details.

## 9. 错误码建议

- `bad_request`: request body, path parameter, or query parameter is invalid.
- `not_found`: generic object not found.
- `validation_failed`: object shape or business field validation failed.
- `project_not_found`: project does not exist or is not accessible.
- `requirement_not_found`: requirement does not exist or is not accessible.
- `dsl_not_ready`: requirement DSL state is not ready for the requested transition.
- `agent_run_failed`: agent run reached failed state.
- `agent_run_timeout`: agent run exceeded allowed duration.
- `agent_run_cancelled`: agent run was cancelled.
- `artifact_missing`: expected artifact is not available.
- `review_blocked`: review state blocks the requested action.
- `pr_not_ready`: PR draft cannot be marked ready or used yet.
- `permission_denied`: user is not allowed to perform the action.
- `secret_redacted`: requested data exists but sensitive content was removed from response.

## 10. 前端当前最需要的最小接口优先级

### P0

- Project list / create project.
- Requirement create / read / update.
- Clarification history save and read.
- DSL draft save and read.
- Design plan read / save.
- Planning task read / create / update.
- Agent run status read.
- Agent run artifacts read.
- Review item read and update.
- PR draft read and save.

### P1

- Project activity log.
- Report index.
- Artifact list and preview.
- Review comments.
- PR checklist update.
- Run event timeline.

### P2

- Permission system.
- Multi-user collaboration.
- Notifications.
- Search.
- Version history diff.
- Advanced artifact retention rules.

## 11. 不在本轮范围内

This requirements document does not ask the backend colleague to implement:

- Real LLM calls.
- Agent code generation.
- Remote PR creation.
- Full user permission system closed loop.
- Online deployment.
- Backend runtime selection.
- Storage engine selection.
- Schema-change files.
- Schema definition statements.
- Data-access model definitions.

These can be considered later only if the frontend workflow explicitly requires them.

## 12. 给后端同事的交付清单

The backend/database collaborator should receive these requirements:

- API contract for project, requirement, clarification, design planning, agent run, review, PR draft, report, artifact, and activity flows.
- Data object descriptions and relationships.
- Business state enums.
- Error code list and expected meanings.
- Persistence requirements for durable records and large artifact references.
- Safety boundaries for redaction, dry-run defaults, execution gating, and PR readiness.
- P0/P1/P2 priority ordering for incremental backend delivery.
