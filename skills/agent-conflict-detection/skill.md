# Agent Conflict Detection

## Description
Detect L3 requirement conflicts and block unsafe patch generation. Converted from agent JSON capability into Markdown dry-run guidance.

## When to Use
- Requirement matches capability conflict-detection.
- Agent planning needs safe candidate targets and acceptance checks.
- JSON capability data must be used without calling the agent runtime.

## Inputs
- requirement: product or engineering request to classify.
- keywords: conflict, cannot modify, do not modify, 不能修改, 冲突, 封面图.
- candidateTargets: none; clarify before locating files.

## Outputs
- applicability: whether the capability should be used.
- dryRunPlan: candidate modules, risks, and non-writing plan.
- acceptanceChecks: Conflict reason is explicit.; No code patch is generated while constraints conflict..
- suggestedCommands: none until repo-specific commands are discovered.

## Steps
1. Read the requirement and decide whether this capability is relevant by keywords, requirement type, and target hints.
2. Collect only candidate files and context notes; do not write changes.
3. Apply context rule: Identify constraints that make the requested persistent feature impossible.
4. Apply context rule: Offer feasible alternatives without violating user constraints.
5. Prepare dry-run plan summary: Block patch generation when requirement constraints conflict with implementation needs.
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
Input: requirement matches ?Detect L3 requirement conflicts and block unsafe patch generation?. Output: applicability = true, dryRunPlan lists candidate targets and acceptance checks; no files are written.
