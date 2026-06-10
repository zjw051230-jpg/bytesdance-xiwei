from typing import Any, Dict, Optional


def _is_code_patch(patch: Dict[str, Any]) -> bool:
    return isinstance(patch, dict) and patch.get("diff") is not None and patch.get("after_snippet") is not None


def execute_patch_plan(
    patch_plan: Optional[Dict[str, Any]],
    review: Optional[Dict[str, Any]],
    repo_adapter=None,
) -> Dict[str, Any]:
    if not isinstance(review, dict):
        return {
            "executed": False,
            "mode": "dry_run",
            "files": [],
            "summary": "Missing review result",
        }

    if review.get("approved") is not True:
        return {
            "executed": False,
            "mode": "dry_run",
            "files": [],
            "summary": "Patch execution blocked because review was not approved",
        }

    if not isinstance(patch_plan, dict) or not patch_plan.get("patches"):
        return {
            "executed": False,
            "mode": "dry_run",
            "files": [],
            "summary": "Missing patch plan",
        }

    files = []
    if repo_adapter is not None:
        failed = False
        failure_reasons = []
        execution_mode = None

        for patch in patch_plan.get("patches", []):
            if _is_code_patch(patch) and hasattr(repo_adapter, "apply_code_patch"):
                patch_result = repo_adapter.apply_code_patch(patch)
            else:
                patch_result = repo_adapter.apply_patch(patch, patch.get("changes", []))
            patch_ok = patch_result.get("ok") is True
            patch_applied = patch_result.get("applied") is True
            patch_dry_run = patch_result.get("dry_run") is True
            patch_preview = patch_result.get("preview") is True
            patch_mode = patch_result.get("mode")
            patch_file = patch.get("path") or patch.get("file", "")
            if patch_mode and execution_mode is None:
                execution_mode = patch_mode

            if not patch_ok:
                failed = True
                failure_reasons.append(patch_result.get("error") or "Patch application failed")

            if not patch_ok:
                status = "failed"
            elif patch_preview:
                status = "preview"
            elif patch_dry_run:
                status = "dry_run"
            elif patch_applied:
                status = "applied"
            else:
                status = "completed"

            files.append(
                {
                    "file": patch_file,
                    "operation": patch_result.get("operation") or patch.get("operation"),
                    "status": status,
                    "changes_applied": list(patch.get("changes", [])),
                    "applied": patch_applied,
                    "dry_run": patch_dry_run,
                    "preview": patch_preview,
                    "approval_required": patch_result.get("approval_required", False),
                    "real_write": patch_result.get("real_write", False),
                    "would_write": patch_result.get("would_write"),
                    "content_preview": patch_result.get("content_preview"),
                    "diff_preview": patch_result.get("diff_preview"),
                    "diff": patch_result.get("diff"),
                    "dry_run_diff": patch_result.get("dry_run_diff"),
                    "preview_diff": patch_result.get("preview_diff"),
                    "before_exists": patch_result.get("before_exists"),
                    "after_exists": patch_result.get("after_exists"),
                    "bytes_written": patch_result.get("bytes_written"),
                    "unsupported_for_real_write": patch_result.get("unsupported_for_real_write", False),
                    "mode": patch_mode or "repo_adapter",
                    "adapter_result": patch_result,
                }
            )

        if failed:
            return {
                "executed": False,
                "mode": execution_mode or "repo_adapter",
                "files": files,
                "preview_result": [item for item in files if item.get("preview")],
                "summary": "Patch execution failed through repo adapter.",
                "error": "; ".join(failure_reasons),
            }

        return {
            "executed": True,
            "mode": execution_mode or "repo_adapter",
            "files": files,
            "preview_result": [item for item in files if item.get("preview")],
            "summary": "Patch execution completed through repo adapter.",
        }

    for patch in patch_plan.get("patches", []):
        files.append(
            {
                "file": patch.get("file", ""),
                "operation": patch.get("operation"),
                "status": "simulated",
                "changes_applied": list(patch.get("changes", [])),
                "diff": patch.get("diff"),
            }
        )

    return {
        "executed": True,
        "mode": "dry_run",
        "files": files,
        "summary": "Simulated patch execution completed for approved patch plan.",
    }
