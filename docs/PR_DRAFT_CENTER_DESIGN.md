# PR Draft Center Design

## Page position

PR Draft Center is the Codex Workbench delivery review page. It generates, saves, edits, inspects, previews, and copies PR draft descriptions. It does not create a GitHub PR, call GitHub APIs, invoke a real LLM, or write to a target repository.

Route:

`/projects/:projectId/requirements/:requirementId/pr-draft`

The existing Workbench PR tab also opens the same page through `src/components/PRWorkbench.jsx`.

## Component structure

- `src/pages/PrDraftCenter.jsx`
- `PrDraftHeader`
- `PrEvidenceNavigator`
- `PrDraftEditor`
- `PrMarkdownPreview`
- `PrReadinessInspector`
- `ChangedFilesSection`
- `TestsSection`
- `RisksSection`
- `ChecklistSection`
- `PrActivityPanel`
- `BlockingReasonsPanel`
- `StatusBadge`
- `ReadinessBadge`

The layout is a dark Codex-like workbench:

- Left: evidence navigator.
- Center: editor or markdown preview.
- Right: readiness inspector.
- Bottom: collapsible activity and artifact references.

## API integration

API access is centralized in `src/api/prDraftClient.js`.

Supported endpoints:

- `GET /api/requirements/:requirementId/pr-draft`
- `POST /api/requirements/:requirementId/pr-draft`
- `PATCH /api/pr-drafts/:prDraftId`
- `GET /api/requirements/:requirementId`
- `GET /api/agent/runs/:runId`
- `GET /api/agent/runs/:runId/review`
- `GET /api/agent/runs/:runId/artifacts`
- `GET /api/projects/:projectId/activity`

The client parses the standard envelope:

```json
{ "ok": true, "data": {}, "error": null }
```

and raises envelope errors for:

- `dsl_not_ready`
- `review_blocked`
- `pr_not_ready`
- `artifact_missing`
- `secret_redacted`
- `not_found`
- `validation_failed`

## Readiness gate rules

Implemented in `evaluateReadiness` inside `src/pages/PrDraftCenter.jsx`.

Ready is allowed only when:

- Requirement readiness is `ready_for_agent` or stronger.
- Agent run is completed or passed.
- Changed files are present.
- No review item is `blocked`.
- No review item is `changes_requested`.
- No required review item is pending.
- Required tests are present and passing.
- High risks are acknowledged or documented.
- Artifact redaction state is safe.
- Checklist blocking items are resolved.

Blocked drafts may still be copied, but the UI requires explicit confirmation.

## Mock fallback

Mock data lives in `src/mocks/prDraftMock.js`.

Cases:

- ready
- blocked by review
- blocked by tests
- copied
- empty draft

The API client uses fallback for unavailable backend, `not_found`, `pr_draft_not_found`, and missing artifact style failures. Validation errors are surfaced in the page error state.

## Copy markdown format

Implemented in `buildPrMarkdown` inside `src/pages/PrDraftCenter.jsx`.

Sections:

- Summary
- Requirement Mapping
- Changed Files
- Tests
- Risks
- Checklist
- Notes

When blocked, the markdown begins with:

```markdown
> Warning: This PR draft still has unresolved blockers.
```

## Current non-goals

- GitHub remote PR creation.
- Real LLM PR generation.
- Real repo write.
- Full permission system.
