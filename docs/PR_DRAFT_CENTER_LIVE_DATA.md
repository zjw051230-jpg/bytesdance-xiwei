# PR Draft Center Live Data

## Data Sources

PR Draft Center loads data through `src/api/prDraftClient.js` and the standard API envelope:

```json
{ "ok": true, "data": {}, "error": null }
```

or:

```json
{ "ok": false, "data": null, "error": { "code": "string", "message": "string", "details": {} } }
```

The page uses these live endpoints:

- `GET /api/requirements/:requirementId`
- `GET /api/requirements/:requirementId/pr-draft`
- `POST /api/requirements/:requirementId/pr-draft`
- `PATCH /api/pr-drafts/:prDraftId`
- `GET /api/agent/runs/:runId`
- `GET /api/agent/runs/:runId/review`
- `GET /api/agent/runs/:runId/artifacts`
- `GET /api/agent/runs/:runId/changes`
- `GET /api/projects/:projectId/activity`

## Removed Mock Fallback

Production PR page code no longer imports `src/mocks/prDraftMock.js`. The previous mock fallback paths were removed from:

- `src/api/prDraftClient.js`
- `src/pages/PrDraftCenter.jsx`

Tests still use local fixtures inside test files only.

## States

- `loading`: initial live API load.
- `empty`: `pr_draft_not_found` or no selected requirement.
- `error`: validation or non-recoverable envelope error.
- `unavailable`: network errors or missing required backend resources.
- `blocked`: one or more readiness gates failed.
- `ready`: all readiness gates pass.
- `copied`: copy succeeded and `PATCH /api/pr-drafts/:prDraftId` accepted copied state.

No API failure falls back to generated success data.

## Field Unavailable

Normalization preserves missing backend fields as empty values so the UI can display `Field unavailable`. Current fields that may show unavailable include:

- Requirement: title, goal, DSL readiness, handoff decision, points.
- Agent run: run id, status, completed timestamp, summary, verification status.
- Changed files: path, summary, rationale, requirement mapping, risk, test status, review status.
- Tests: status, source, error summary.
- Risks: level, message, mitigation.
- Artifacts: type, redaction state, created timestamp, preview.
- Activity: actor, action, created timestamp.
- PR draft: title, summary, notes, copiedAt.

## Copy And Regenerate

Copy builds markdown from the live draft plus current editor state. If the PR is blocked, the UI asks for confirmation before clipboard write. After copy, it calls `PATCH /api/pr-drafts/:prDraftId` with `status` and `copiedAt`. If PATCH fails, the UI reports the save failure instead of pretending success.

Regenerate calls `POST /api/requirements/:requirementId/pr-draft` with `{ runId, regenerate: true }`. If the backend is unavailable, the UI shows an unavailable message and does not create fake draft content.
