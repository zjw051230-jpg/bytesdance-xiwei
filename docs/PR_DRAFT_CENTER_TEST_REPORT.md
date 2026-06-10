# PR Draft Center Test Report

## Scope

This report covers the implemented PR Draft Center page, API client, mock fallback, readiness gates, copy markdown behavior, and redaction-safe artifact rendering.

## Test coverage

Automated tests were added in:

- `src/pages/PrDraftCenter.test.jsx`
- `src/api/prDraftClient.test.js`

Covered cases:

- PR page renders.
- Blocked review item makes readiness blocked.
- Ready case shows ready.
- Copy button generates markdown.
- Blocked copy asks for warning confirmation.
- Checklist blocking item prevents ready.
- Redacted artifact does not expose raw secret content.
- API envelope success parses correctly.
- API envelope error displays ErrorState.
- Mock fallback is usable.

## Commands

Verification completed:

```bash
npm test
npm run build
```

Results:

- `npm test`: passed, 16 test files, 170 tests.
- `npm run build`: passed, Vite production build completed.
- Playwright render check: passed at `http://127.0.0.1:10001/projects/codex-workbench/requirements/req-ready/pr-draft`; screenshot saved to `reporting/pr-draft-center-playwright.png`.

This project does not currently define `lint` or `typecheck` scripts in `package.json`.

## Current support

- Workbench PR tab entry.
- Direct route entry: `/projects/:projectId/requirements/:requirementId/pr-draft`.
- Envelope-aware API client.
- Mock fallback cases.
- Editable title, summary, notes, checklist, and risks.
- Live markdown preview.
- Copy with clipboard fallback.
- Save and regenerate actions with mock fallback.
- Redaction-safe artifact previews.

## Current non-support

- GitHub remote PR creation.
- Real LLM draft generation.
- Real target repository writes.
- Full permission system.
