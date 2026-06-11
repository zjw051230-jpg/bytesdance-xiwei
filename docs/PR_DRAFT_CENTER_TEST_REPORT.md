# PR Draft Center Test Report

## Scope

This report covers the live-data PR Draft Center page, API envelope client, overview-first layout, readiness gates, copy/regenerate behavior, no-mock production path, and unavailable/empty/error states.

## Automated Coverage

Updated tests:

- `src/pages/PrDraftCenter.test.jsx`
- `src/api/prDraftClient.test.js`

Covered cases:

- PR page renders from live API envelopes.
- No production PR page code imports mock modules.
- No mock fallback is used when the backend fails.
- Missing PR draft shows `EmptyState`.
- Network or missing required resource shows `UnavailableState`.
- Validation envelope errors show `ErrorState`.
- Review `blocked` or `changes_requested` prevents ready.
- Missing tests prevent ready.
- Unacknowledged high risk prevents ready.
- Blocking checklist item prevents ready.
- Copying a blocked PR asks for warning confirmation.
- Successful copy writes markdown and calls `PATCH /api/pr-drafts/:prDraftId`.
- Regenerate calls `POST /api/requirements/:requirementId/pr-draft`.
- Markdown preview is generated from live draft data.
- Standard success and error envelopes are parsed correctly.
- Optional source failures are marked unavailable without creating fake data.

## Latest Verification

Completed during this change:

```bash
npm test -- src/pages/PrDraftCenter.test.jsx src/api/prDraftClient.test.js
```

Result:

- Passed: 2 files, 19 tests.

Full-project commands still to run after documentation update:

- `npm test`
- `npm run build`

This project does not define `lint` or `typecheck` scripts in `package.json`.
