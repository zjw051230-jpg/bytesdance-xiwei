# DSL Gap Vector Retrieval

## Description
Builds a gap vector between PM intent, DSL fields, risk factors, and candidate code context.

## When to Use
- DSL coverage gaps need ranking.
- Repo hints must influence clarification without becoming confirmed facts.
- A draft needs missing coverage analysis.

## Inputs
- pmInput: source requirement.
- dslDraft: current structured draft.
- codeContext: optional candidate routes, components, APIs, or tests.
- riskReport: optional activated factors.

## Outputs
- gapVector: missing fields and evidence source.
- candidateHints: repo-grounded hints with candidate wording.
- baselineNeeds: checks required before confirmation.

## Steps
1. Compare PM atoms to DSL fields.
2. Compare risk and schema blockers to draft content.
3. Read code context as candidate information only.
4. Rank gaps by user impact and readiness blocking value.
5. Return gap vector and baseline needs.

## Safety Rules
- Run as dry-run guidance only.
- Do not perform real repository writes.
- Do not call a live model or agent runtime.
- Do not read or output credential values.
- Keep candidate code context as candidate evidence until separately verified.

## Validation
- No candidate hint is marked confirmed.
- Gaps cite PM, schema, risk, or code-context source.
- Test hints remain command discovery only.

## Example
Input: PM says ?use existing LoginForm.? Output: candidateHints may cite LoginForm, while baselineNeeds says verify the actual component before handoff.
