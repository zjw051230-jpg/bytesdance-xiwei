# Agent PR Draft

## Description
Builds a PR draft from dry-run plan, review findings, and validation notes without creating a remote PR.

## When to Use
- A reviewed dry-run result needs PR copy.
- Changed files, tests, and risks must be summarized for handoff.
- Remote PR creation is out of scope.

## Inputs
- reviewItems: human or agent review rows.
- planSummary: dry-run plan result.
- validationNotes: commands to run or observed test results.

## Outputs
- title: PR draft title.
- body: summary, changed files, tests, risks, and checklist.
- readiness: draft, blocked, or ready-for-human-copy.

## Steps
1. Read review and plan summaries.
2. Separate observed tests from recommended tests.
3. Write concise PR title and body.
4. Include risks and unresolved blockers.
5. Return draft text only; do not call remote services.

## Safety Rules
- Run as dry-run guidance only.
- Do not perform real repository writes.
- Do not call a live model or agent runtime.
- Do not read or output credential values.
- Keep candidate code context as candidate evidence until separately verified.
- Do not create remote pull requests or trigger agent execution.

## Validation
- PR draft does not claim unrun tests passed.
- Remote creation is not attempted.
- Blocked review items keep readiness blocked.

## Example
Input: review passed with npm test observed. Output: PR draft body lists summary, files, npm test result, and residual risk.
