# Agent Clarify First

## Description
Pause ambiguous L3 requirements and produce structured clarification before code generation. Converted from agent JSON capability into Markdown dry-run guidance.

## When to Use
- Requirement matches capability clarify-first.
- Agent planning needs safe candidate targets and acceptance checks.
- JSON capability data must be used without calling the agent runtime.

## Inputs
- requirement: product or engineering request to classify.
- keywords: ambiguous, clarify, modern, reading experience, 澄清, 现代, 阅读体验.
- candidateTargets: none; clarify before locating files.

## Outputs
- applicability: whether the capability should be used.
- dryRunPlan: candidate modules, risks, and non-writing plan.
- acceptanceChecks: Clarification questions are produced.; No code patch is generated before the user chooses a concrete direction..
- suggestedCommands: none until repo-specific commands are discovered.

## Steps
1. Read the requirement and decide whether this capability is relevant by keywords, requirement type, and target hints.
2. Collect only candidate files and context notes; do not write changes.
3. Apply context rule: Do not generate code patches until the ambiguous scope is narrowed.
4. Apply context rule: List plausible interpretations and ask concrete clarification questions.
5. Prepare dry-run plan summary: Clarify ambiguous requirement before implementation.
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
Input: requirement matches ?Pause ambiguous L3 requirements and produce structured clarification before code generation?. Output: applicability = true, dryRunPlan lists candidate targets and acceptance checks; no files are written.
