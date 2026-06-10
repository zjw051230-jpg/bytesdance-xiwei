# Agent Cover Image

## Description
Add article cover image support. Converted from agent JSON capability into Markdown dry-run guidance.

## When to Use
- Requirement matches capability cover-image.
- Agent planning needs safe candidate targets and acceptance checks.
- JSON capability data must be used without calling the agent runtime.

## Inputs
- requirement: product or engineering request to classify.
- keywords: 灏侀潰, 封面, cover image, article cover, image.
- candidateTargets: backend/src/models/Article.js, backend/models, backend/src/routes/articles.js, backend/routes, backend/controllers, frontend/src/pages/Editor.jsx, frontend/src/pages/Article.jsx, frontend/src/routes/ArticleEditor.jsx.

## Outputs
- applicability: whether the capability should be used.
- dryRunPlan: candidate modules, risks, and non-writing plan.
- acceptanceChecks: Article can store a cover image; Article page displays cover image.
- suggestedCommands: npm run lint, pytest -q.

## Steps
1. Read the requirement and decide whether this capability is relevant by keywords, requirement type, and target hints.
2. Collect only candidate files and context notes; do not write changes.
3. Apply context rule: Inspect article model and API schema
4. Apply context rule: Inspect editor page and article page rendering
5. Prepare dry-run plan summary: Prepare a medium-risk fullstack patch for article cover image support.
6. Summarize patch areas without writing files: Article model should store cover image metadata; Article editor should accept cover image input
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
Input: requirement matches ?Add article cover image support?. Output: applicability = true, dryRunPlan lists candidate targets and acceptance checks; no files are written.
