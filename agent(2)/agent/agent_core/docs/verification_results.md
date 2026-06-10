# Verification Results

This note records the final local acceptance expectations for the Agent project.
It is intentionally separate from generated result JSON files so the repository
can stay small while still documenting how the L1/L2/L3 checks were verified.

## Regression Commands

Run these commands from `D:\agent` unless a working directory is noted.

```powershell
python -m unittest discover -s codex-verify -v
python -m agent_core.scripts.demo_check
```

Run the backend tests from `D:\agent\context-service-handoff\context-service-handoff\code\backend`.

```powershell
npm test
```

Expected result: all three commands pass. These commands do not enable real
repository writes by default and do not bypass validation, review, or execution
safety gates.

## L1 Acceptance

Sample DSL: `agent_core/examples/dsl/l1_article_word_stats.json`

Expected behavior:
- Match the article word statistics skill.
- Generate a focused article detail patch.
- Validate and review the patch before execution.
- In real apply acceptance, apply to the target repo only when the explicit
  RealRepo write gates are enabled, confirm the git diff, then roll back.

Recorded local acceptance:
- L1 PASS: `article-word-stats`
- Real apply, git diff inspection, and rollback passed.

## L2 Acceptance

Sample DSL: `agent_core/examples/dsl/l2_article_cover_image.json`

Expected behavior:
- Match the cover-image skill.
- Cover the required implementation roles: article model, write payload,
  editor form, and article detail display.
- Do not generate unused read-service helpers such as `withCoverImage` in
  `frontend/src/services/getArticle.js` when the read service requires no change.
- Validate and review the generated CodePatches before execution.
- In real apply acceptance, apply only with explicit RealRepo write gates,
  inspect the git diff, then roll back.

Recorded local acceptance:
- L2 PASS: `cover-image`
- Patch count may be 4 after removing the unused getArticle helper.
- Validation, review, apply, git diff inspection, and rollback passed.

## L3 Acceptance

Sample DSLs:
- `agent_core/examples/dsl/l3_ambiguous_article_experience.json`
- `agent_core/examples/dsl/l3_conflicting_cover_image.json`
- `agent_core/examples/dsl/l3_multimodule_rating.json`

L3 is not a direct code-writing benchmark. It verifies that the Agent can pause
when requirements are unclear, detect conflicts, and decompose broad work before
making changes.

Expected behavior:
- Ambiguous article experience: status is `clarification_required` or paused,
  clarification questions are present, `patch_count=0`, and `execute_patch` is
  not selected.
- Conflicting cover image constraints: status is `blocked`, `conflict_reason`
  is present, `patch_count=0`, and `execute_patch` is not selected.
- Multi-module rating system: status is `planning_paused` or paused, staged
  backend/frontend/test/risk planning is present, `patch_count=0`, and
  `execute_patch` is not selected.

Recorded local acceptance:
- L3 PASS: ambiguous requirement produced clarification questions.
- L3 PASS: conflicting requirement produced a conflict reason and did not patch.
- L3 PASS: multi-module rating produced a staged plan and did not patch.

## Local Result Artifacts

The following JSON files are useful local acceptance artifacts:

- `l1_result.json`
- `l2_result.json`
- `l3_ambiguous_result.json`
- `l3_conflict_result.json`
- `l3_multimodule_result.json`

These files are generated local verification outputs. They do not necessarily
need to be committed to the code repository; the DSL examples, tests, and this
verification note are the durable project artifacts.

## Safety Boundaries

The final acceptance assumes these boundaries remain intact:
- RealRepo writes are disabled by default.
- Apply is not enabled unless explicit environment gates are set.
- Validation and review gates remain in the execution path.
- L3 clarification, conflict, and planning pauses do not proceed to patch
  execution.
