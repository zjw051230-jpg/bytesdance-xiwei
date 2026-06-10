# Agent Conduit Article

## Description
Conduit realworld article feature changes. Converted from agent JSON capability into Markdown dry-run guidance.

## When to Use
- Requirement matches capability conduit-article.
- Agent planning needs safe candidate targets and acceptance checks.
- JSON capability data must be used without calling the agent runtime.

## Inputs
- requirement: product or engineering request to classify.
- keywords: conduit, realworld, article, editor, feed.
- candidateTargets: frontend/src/pages/Article.jsx, frontend/src/pages/Editor.jsx, Article.jsx, Editor.jsx, article.

## Outputs
- applicability: whether the capability should be used.
- dryRunPlan: candidate modules, risks, and non-writing plan.
- acceptanceChecks: Conduit article behavior satisfies the requirement.
- suggestedCommands: npm run lint.

## Steps
1. Read the requirement and decide whether this capability is relevant by keywords, requirement type, and target hints.
2. Collect only candidate files and context notes; do not write changes.
3. Apply context rule: Use Conduit frontend and backend structure when a repo profile is available
4. Apply context rule: Prefer concrete page, API, model, route, and controller files over generic placeholders
5. Prepare dry-run plan summary: Prepare a Conduit article patch plan.
6. Summarize patch areas without writing files: Conduit article feature should be implemented in the located article module
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
Input: requirement matches ?Conduit realworld article feature changes?. Output: applicability = true, dryRunPlan lists candidate targets and acceptance checks; no files are written.
