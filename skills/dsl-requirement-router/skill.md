# DSL Requirement Router

## Description
Routes PM or PRD input into a conservative RequirementDSL draft path and decides whether clarification is needed before downstream work.

## When to Use
- PM text needs a RequirementDSL draft.
- Existing DSL needs routing or readiness classification.
- A requirement type must be selected without entering implementation.

## Inputs
- pmInput: PM text, PRD notes, or multi-turn requirement summary.
- existingDsl: optional draft to preserve and repair.
- codeContext: optional candidate hints from repository context.

## Outputs
- routeDecision: requirement type and readiness recommendation.
- draftNotes: phrase-level DSL extraction notes.
- clarificationNeeds: unknowns that should block handoff.

## Steps
1. Read the PM or PRD input fully.
2. Extract actor, target surface, requested change, out-of-scope boundaries, risks, and acceptance checks.
3. Classify the requirement type conservatively.
4. Mark unknown or candidate-only fields instead of confirming them.
5. Return routing and draft notes without implementation planning.

## Safety Rules
- Run as dry-run guidance only.
- Do not perform real repository writes.
- Do not call a live model or agent runtime.
- Do not read or output credential values.
- Keep candidate code context as candidate evidence until separately verified.

## Validation
- Output preserves PM intent.
- Unknowns are visible.
- No candidate path is promoted to confirmed evidence.

## Example
Input: ???????????? Output: routeDecision = UI feedback clarification, clarificationNeeds includes exact failed states and desired next action.
