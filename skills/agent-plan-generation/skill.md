# Agent Plan Generation

## Description
Creates a dry-run agent implementation plan from a DSL or requirement context without executing changes.

## When to Use
- A requirement is ready for planning preview.
- Agent plan structure is needed for review before execution.
- Broad implementation work must be decomposed safely.

## Inputs
- requirementDsl: structured requirement or summarized task.
- repoContext: candidate files and constraints.
- safetyBoundary: allowed and forbidden paths.

## Outputs
- planSteps: ordered dry-run steps.
- candidateFiles: files to inspect or modify later.
- riskNotes: blockers and review focus.

## Steps
1. Read the DSL and safety boundary.
2. Separate planning from execution.
3. List candidate files and dependencies.
4. Break work into inspect, patch-preview, test-preview, and review phases.
5. Return the plan without invoking runtime actions.

## Safety Rules
- Run as dry-run guidance only.
- Do not perform real repository writes.
- Do not call a live model or agent runtime.
- Do not read or output credential values.
- Keep candidate code context as candidate evidence until separately verified.
- Do not create remote pull requests or trigger agent execution.

## Validation
- Plan has no direct write instruction.
- Forbidden paths are called out.
- Each step has an observable dry-run output.

## Example
Input: ready DSL for UI copy. Output: planSteps include inspect component, draft patch preview, run tests after approval.
