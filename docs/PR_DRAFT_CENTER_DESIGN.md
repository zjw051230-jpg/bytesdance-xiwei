# PR Draft Center Design

## Page Position

PR Draft Center is the delivery review page for one requirement. It reviews requirement readiness, agent run evidence, review items, changed files, tests, risks, artifacts, checklist state, and the editable PR markdown draft.

It does not call GitHub APIs, create a remote PR, call a real LLM, write to a repository, or change backend contracts.

Route:

`/projects/:projectId/requirements/:requirementId/pr-draft`

The Workbench PR tab still renders the same page through `src/components/PRWorkbench.jsx`.

## Structure

Implemented in `src/pages/PrDraftCenter.jsx`.

- `PRHeader`: live source and readiness status.
- `PRDraftEditor`: editable title, summary, and notes.
- `PRReadinessOverview`: compact gate cards.
- `PRActionBar`: save, regenerate, preview, copy, ready.
- `ReadinessInspector`: blocking reasons and gate list.
- `DetailLaunchPanel`: detail entry points.
- `PRDetailDialog`: requirement, changed files, review, tests, risks, artifacts, checklist, markdown, and activity details.

The main page is overview first. Long lists, tables, markdown preview, activity, and checklist detail are opened with native `dialog` or `details`.

## TaskSkills Role

`src/adapters/prDraftTaskSkills.js` is declarative only. It describes:

- Which cards belong in the overview.
- Which detail surfaces exist.
- Whether a detail belongs in a dialog or details disclosure.
- Which gates participate in readiness.
- Which live source supports each card.

It does not fetch APIs, operate on DOM, call `showModal`, or create mock data.

## Native UI

The page uses native browser capabilities:

- `dialog` for details on demand.
- `details` / `summary` for activity and structured detail sections.
- `table` for changed files, reviews, tests, artifacts, and activity.
- `meter` for readiness progress.
- `time` for copied and activity timestamps.
- `button`, `input`, and `textarea` for actions and editing.

## Readiness Gate

Implemented by `evaluateReadiness` in `src/pages/PrDraftCenter.jsx`.

PR can be ready only when:

- Requirement readiness is `ready_for_agent`, `handoff_to_agent`, `ready`, or `strong`.
- Agent run status is `completed` or `passed`.
- Changed files are present.
- No review item is `blocked`.
- No review item is `changes_requested`.
- No required review item is `pending`.
- Required tests exist and are not missing, failed, or errored.
- High, critical, or p0 risks are acknowledged.
- Artifacts exist and no artifact redaction state is unsafe.
- Blocking checklist items are checked.

If any gate fails, status is `blocked`, ready is disabled, and the inspector lists blocking reasons. Copy remains available after confirmation.

## Visual Direction

The page keeps the dark Codex-like engineering workbench style. The visual hierarchy favors compact gate status, clear blocked/unavailable states, and dense detail tables only after opening a detail surface. Blocked and unavailable states are red or amber and never styled as success.
