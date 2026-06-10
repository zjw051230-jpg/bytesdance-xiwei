# DSL Schema Activation

## Description
Selects required DSL schema sections and blocking fields for a routed requirement.

## When to Use
- A routed requirement needs schema section activation.
- Required fields need to be identified before clarification.
- Readiness should stay blocked until schema blockers are resolved.

## Inputs
- routeDecision: requirement type and scope.
- dslDraft: current RequirementDSL candidate.
- schemaRules: schema or activation notes.

## Outputs
- activatedSections: schema sections needed for this requirement.
- blockingFields: required missing fields.
- fieldRationale: why each section matters.

## Steps
1. Read route decision and schema notes.
2. Map requirement type to required DSL sections.
3. Identify missing or candidate-only fields.
4. Classify missing fields as PM question, baseline check, or non-blocking note.
5. Return activation result without mutating the DSL.

## Safety Rules
- Run as dry-run guidance only.
- Do not perform real repository writes.
- Do not call a live model or agent runtime.
- Do not read or output credential values.
- Keep candidate code context as candidate evidence until separately verified.

## Validation
- Every blocking field has a reason.
- Candidate fields remain candidate.
- No implementation plan is generated.

## Example
Input: frontend copy change. Output: activate target surface, acceptance checks, and copy boundary; do not require backend data retention fields unless risk evidence exists.
