# Agent Pipeline

## analyze_requirement

Input:

- `state.user_input`

Output:

- Requirement understanding observation.

Produces event:

- None.

Produces node:

- None.

## select_skill

Input:

- `state.user_input`
- local skill registry

Output:

- `state.matched_skill`
- observation with matched skill result

Produces event:

- None.

Produces node:

- None.

## make_plan

Input:

- `state.user_input`
- `state.matched_skill`
- runtime instructions

Output:

- `state.artifacts["plan"]`

Produces event:

- `PLAN_CREATED`

Produces node:

- `plan_{current_step}`

## locate_files

Input:

- `state.artifacts["plan"]`
- `state.matched_skill`

Output:

- `state.artifacts["located_files"]`

Produces event:

- None.

Produces node:

- None.

## generate_patch

Input:

- `state.user_input`
- `state.matched_skill`
- `state.artifacts["plan"]`
- `state.artifacts["located_files"]`

Output:

- `state.artifacts["patch_plan"]`

Produces event:

- `PATCH_GENERATED`

Produces node:

- `patch_{current_step}`

## review_patch

Input:

- `state.artifacts["plan"]`
- `state.artifacts["located_files"]`
- `state.artifacts["patch_plan"]`

Output:

- `state.artifacts["review"]`

Produces event:

- `REVIEW_COMPLETED`

Produces node:

- `review_{current_step}`

## execute_patch

Input:

- `state.artifacts["patch_plan"]`
- `state.artifacts["review"]`
- repo adapter

Output:

- `state.artifacts["execution_result"]`

Produces event:

- `EXECUTION_COMPLETED`

Produces node:

- `sandbox_{current_step}`

## verify_result

Input:

- `state.artifacts["plan"]`
- `state.artifacts["execution_result"]`
- test adapter

Output:

- `state.artifacts["verification_result"]`

Produces event:

- `VERIFICATION_COMPLETED`

Produces node:

- `verify_{current_step}`

## finish

Input:

- plan, located files, patch plan, review, execution result, verification result
- memory adapter

Output:

- `state.artifacts["final_summary"]`
- `state.status = "SUCCESS"`

Produces event:

- `TASK_FINISHED`

Produces node:

- `finish_{current_step}`
