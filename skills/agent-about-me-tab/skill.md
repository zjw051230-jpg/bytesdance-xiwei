# Agent About Me Tab

## Description
Add About Me tab on profile page. Converted from agent JSON capability into Markdown dry-run guidance.

## When to Use
- Requirement matches capability about-me-tab.
- Agent planning needs safe candidate targets and acceptance checks.
- JSON capability data must be used without calling the agent runtime.

## Inputs
- requirement: product or engineering request to classify.
- keywords: about me, 个人简介, 个人主页, profile about, profile tab, bio.
- candidateTargets: frontend/src/pages/Profile.jsx, frontend/src/components/Tabs.jsx, frontend/src/pages/Profile.jsx, Profile.jsx, Tabs.jsx, profile.

## Outputs
- applicability: whether the capability should be used.
- dryRunPlan: candidate modules, risks, and non-writing plan.
- acceptanceChecks: Profile page shows About Me tab; Tab content renders correctly.
- suggestedCommands: npm run lint.

## Steps
1. Read the requirement and decide whether this capability is relevant by keywords, requirement type, and target hints.
2. Collect only candidate files and context notes; do not write changes.
3. Apply context rule: Prefer profile page files
4. Apply context rule: Search tab navigation components
5. Prepare dry-run plan summary: Prepare a low-risk frontend patch for the profile tab experience.
6. Summarize patch areas without writing files: Profile page needs a dedicated About Me tab and bio section
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
Input: requirement matches ?Add About Me tab on profile page?. Output: applicability = true, dryRunPlan lists candidate targets and acceptance checks; no files are written.
