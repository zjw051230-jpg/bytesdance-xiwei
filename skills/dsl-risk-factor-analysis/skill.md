# DSL Risk Factor Analysis

## Description
Evaluates activated risk factors and records observed risk coverage for RequirementDSL quality checks.

## When to Use
- Risk factors need review before readiness promotion.
- False positives or false negatives must be documented.
- A DSL draft needs risk traceability.

## Inputs
- riskFactors: activated factor list or dictionary excerpts.
- dslDraft: RequirementDSL candidate.
- expectedCases: optional black-box cases.

## Outputs
- riskReport: activated factors, missing factors, and rationale.
- coverageFindings: observed versus expected behavior.
- recommendations: schema or dictionary sync notes.

## Steps
1. Load factor IDs and meanings from the provided material.
2. Compare DSL content to activation cases.
3. Record matched factors and missed high-value factors.
4. Separate observed behavior from inference.
5. Return recommendations without changing dictionaries.

## Safety Rules
- Run as dry-run guidance only.
- Do not perform real repository writes.
- Do not call a live model or agent runtime.
- Do not read or output credential values.
- Keep candidate code context as candidate evidence until separately verified.

## Validation
- Findings name factor IDs.
- Report distinguishes observed and inferred behavior.
- No dictionary or schema mutation is requested.

## Example
Input: DSL mentions payment retry. Output: riskReport includes idempotency and duplicate-charge checks if evidence supports them.
