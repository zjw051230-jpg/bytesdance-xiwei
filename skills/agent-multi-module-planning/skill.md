# Agent Multi Module Planning

## Description
Decompose L3 multi-module requirements into staged backend, frontend, test, and risk plans. Converted from agent JSON capability into Markdown dry-run guidance.

## When to Use
- Requirement matches capability multi-module-planning.
- Agent planning needs safe candidate targets and acceptance checks.
- JSON capability data must be used without calling the agent runtime.

## Inputs
- requirement: product or engineering request to classify.
- keywords: rating, stars, multi-module, 评分, 星.
- candidateTargets: backend/models, backend/routes, frontend/src/routes, frontend/src/components, frontend/src/services, backend/models, backend/routes, backend/controllers.

## Outputs
- applicability: whether the capability should be used.
- dryRunPlan: candidate modules, risks, and non-writing plan.
- acceptanceChecks: Backend, frontend, test, and risk workstreams are identified.; Ambiguous voting policy is clarified before code is applied..
- suggestedCommands: npm test.

## Steps
1. Read the requirement and decide whether this capability is relevant by keywords, requirement type, and target hints.
2. Collect only candidate files and context notes; do not write changes.
3. Apply context rule: Produce a staged plan before broad cross-stack changes.
4. Apply context rule: Ask policy questions for underspecified rating semantics.
5. Prepare dry-run plan summary: Produce multi-module staged plan only until rating policy is clarified.
6. If no patch is appropriate, return blocker or clarification output.
7. Return acceptance checks and suggested verification commands as recommendations only.

## Safety Rules
- Run as dry-run guidance only.
- Do not perform real repository writes.
- Do not call a live model or agent runtime.
- Do not read or output credential values.
- Keep candidate code context as candidate evidence until separately verified.
- Treat all patch strategy entries as preview guidance only.
- Require explicit approval and a separate executor before any real write mode.

## Validation
- Capability matches at least one requirement type, keyword, or target hint.
- Output states whether patch generation is blocked, dry-run only, or needs clarification.
- Acceptance checks are preserved without claiming they passed.

## Example
Input: requirement matches ?Decompose L3 multi-module requirements into staged backend, frontend, test, and risk plans?. Output: applicability = true, dryRunPlan lists candidate targets and acceptance checks; no files are written.
