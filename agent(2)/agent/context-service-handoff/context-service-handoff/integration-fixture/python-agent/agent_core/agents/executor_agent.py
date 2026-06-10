from typing import Any, Dict, Optional


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
        execution_mode = "mock_repo"
        for patch in patch_plan.get("patches", []):
            patch_result = repo_adapter.apply_patch(patch.get("file", ""), patch.get("changes", []))
            if patch_result.get("mode") and patch_result.get("mode") != "mock":
                execution_mode = patch_result["mode"]
            files.append(
                {
                    "file": patch.get("file", ""),
                    "status": "applied",
                    "changes_applied": list(patch.get("changes", [])),
                    "applied": patch_result.get("applied", True),
                    "mode": patch_result.get("mode", "mock_repo"),
                    "adapter_result": patch_result,
                }
            )

        return {
            "executed": True,
            "mode": execution_mode,
            "files": files,
            "summary": "Patch execution completed through repo adapter.",
        }

    for patch in patch_plan.get("patches", []):
        files.append(
            {
                "file": patch.get("file", ""),
                "status": "simulated",
                "changes_applied": list(patch.get("changes", [])),
            }
        )

    return {
        "executed": True,
        "mode": "dry_run",
        "files": files,
        "summary": "Simulated patch execution completed for approved patch plan.",
    }
