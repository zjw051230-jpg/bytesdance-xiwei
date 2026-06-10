# Agent Review Check

## Description
Reviews an agent dry-run patch preview for requirement mapping, risk, and validation gaps.

## When to Use
- A dry-run patch or plan needs human review rows.
- Review items must map changes to requirements.
- Risk and test status should be summarized before PR drafting.

## Inputs
- dryRunPatch: patch preview or file-change summary.
- requirementDsl: requirement and acceptance checks.
- testPreview: planned or observed validation notes.

## Outputs
- reviewItems: file-level review checks.
- riskSummary: low, medium, or high concern list.
- reworkNeeded: blockers before approval.

## Steps
1. Read requirement and patch preview.
2. Map each changed file to requirement points.
3. Identify risk, missing tests, and unclear ownership.
4. Classify review status without approving real writes.
5. Return review items for human decision.

## Safety Rules
- Run as dry-run guidance only.
- Do not perform real repository writes.
- Do not call a live model or agent runtime.
- Do not read or output credential values.
- Keep candidate code context as candidate evidence until separately verified.
- Do not create remote pull requests or trigger agent execution.

## Validation
- Every review item has file path, reason, and requirement mapping.
- Risks are concrete.
- No approval is implied without human review.

## Example
Input: patch preview touches LoginForm. Output: review item maps copy change to acceptance check and asks for login failure state test.
