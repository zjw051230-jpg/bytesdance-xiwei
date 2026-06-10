# Agent Runtime DSL Examples

This directory contains Requirement DSL examples for demonstrating the Agent Runtime against a Conduit realworld-style monorepo.

Before running, edit each sample's `target_repo` field so it points to your local Conduit repo root. The expected shape is:

```text
<target_repo>/
  frontend/package.json
  frontend/src/...
  backend/package.json
  backend/src...
```

## Run With JSON Output

PowerShell:

```powershell
$env:AGENT_OUTPUT_JSON="1"
Get-Content agent_core/examples/dsl/l1_article_word_stats.json -Raw | python -m agent_core.main
```

CMD:

```cmd
set AGENT_OUTPUT_JSON=1
type agent_core\examples\dsl\l1_article_word_stats.json | python -m agent_core.main
```

## Repo Preview Mode

Real repo preview is the default safe behavior when `target_repo` is supplied in DSL. The Agent can inspect files, produce patch previews, and prepare verification previews without writing files or running real tests.

To use environment-driven repo mode instead of DSL `target_repo`:

```powershell
$env:AGENT_OUTPUT_JSON="1"
$env:AGENT_REPO_MODE="real"
$env:AGENT_REPO_ROOT="D:\path\to\conduit-realworld"
Get-Content agent_core/examples/dsl/l1_profile_about_tab.json -Raw | python -m agent_core.main
```

Do not set these unless you intentionally want controlled real writes:

```text
AGENT_REPO_APPLY=1
AGENT_REPO_CONFIRM=YES
```

## LLM Action Decision

The default action sequence is deterministic. To demo LLM action selection:

```powershell
$env:AGENT_OUTPUT_JSON="1"
$env:AGENT_LLM_PROVIDER="doubao"
$env:DOUBAO_API_KEY="<your-key>"
$env:DOUBAO_ENDPOINT="<your-endpoint>"
$env:AGENT_LLM_ACTION_DECISION="1"
Get-Content agent_core/examples/dsl/l2_article_cover_image.json -Raw | python -m agent_core.main
```

Planner and coder LLM calls are separately gated:

```text
AGENT_USE_LLM_PLANNER=1
AGENT_USE_LLM_CODER=1
```

LLM calls are reported in the JSON result under:

```text
llm_metrics
llm_metrics_summary
```

## Suggested Demo Order

1. Run `l1_article_word_stats.json` to show frontend L1 planning, location, preview execution, verification preview, PR draft, recall, and metrics.
2. Run `l1_profile_about_tab.json` to show a second L1 frontend workflow.
3. Run `l2_article_cover_image.json` to show fullstack planning across backend model/routes/controllers and frontend editor/article surfaces.
