# DSL Scoring

## Description
Scores DSL readiness, coverage, blockers, and handoff safety without executing downstream work.

## When to Use
- A DSL draft needs readiness scoring.
- Coverage percent or blockers need a dry-run explanation.
- Handoff safety must be evaluated conservatively.

## Inputs
- dslDraft: RequirementDSL candidate.
- riskReport: activated risk factors.
- gapVector: missing coverage and blockers.
- schemaActivation: required sections and fields.

## Outputs
- score: numeric or qualitative readiness summary.
- blockingReasons: unresolved issues.
- handoffDecision: clarify-first or ready-for-planning recommendation.

## Steps
1. Check schema completeness.
2. Check risk and gap blockers.
3. Score clarity, acceptance coverage, scope boundaries, and baseline evidence.
4. Downgrade readiness for unknowns or candidate-only evidence.
5. Return score and blockers without executing handoff.

## Safety Rules
- Run as dry-run guidance only.
- Do not perform real repository writes.
- Do not call a live model or agent runtime.
- Do not read or output credential values.
- Keep candidate code context as candidate evidence until separately verified.

## Validation
- Score explains blockers.
- Ready states require evidence, not hints.
- Output never claims tests passed unless evidence is provided.

## Example
Input: DSL has acceptance criteria but no failure states. Output: score below handoff threshold with blocker ?missing exact failure scenarios.?
