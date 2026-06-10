# Agent Article Word Stats

## Description
Add word count and reading time to article detail page. Converted from agent JSON capability into Markdown dry-run guidance.

## When to Use
- Requirement matches capability article-word-stats.
- Agent planning needs safe candidate targets and acceptance checks.
- JSON capability data must be used without calling the agent runtime.

## Inputs
- requirement: product or engineering request to classify.
- keywords: 瀛楁暟, 字数, 阅读时间, 文章详情, word count, reading time, article stats.
- candidateTargets: frontend/src/pages/Article.jsx, Article.jsx, frontend/src/components, frontend/src/pages/Article.jsx, Article.jsx, article, frontend/src/components.

## Outputs
- applicability: whether the capability should be used.
- dryRunPlan: candidate modules, risks, and non-writing plan.
- acceptanceChecks: Article detail page shows word count; Article detail page shows estimated reading time; Existing article rendering is not broken; 不破坏原文章渲染.
- suggestedCommands: npm run lint.

## Steps
1. Read the requirement and decide whether this capability is relevant by keywords, requirement type, and target hints.
2. Collect only candidate files and context notes; do not write changes.
3. Apply context rule: Prefer article detail page files
4. Apply context rule: Search article body rendering and content display code
5. Prepare dry-run plan summary: Prepare a low-risk frontend patch for article stats display.
6. Summarize patch areas without writing files: Article detail page needs word count and reading time display
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
Input: requirement matches ?Add word count and reading time to article detail page?. Output: applicability = true, dryRunPlan lists candidate targets and acceptance checks; no files are written.
