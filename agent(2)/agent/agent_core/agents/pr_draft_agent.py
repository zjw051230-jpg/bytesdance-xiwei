from typing import Any, Dict, List, Optional

from agent_core.requirement_dsl import build_acceptance_criteria_coverage


def _list_strings(values) -> List[str]:
    result = []
    for item in values or []:
        if isinstance(item, str) and item.strip() and item not in result:
            result.append(item)
    return result


def _patch_file(patch: Dict[str, Any]) -> Optional[str]:
    value = patch.get("file") or patch.get("path")
    return value if isinstance(value, str) and value.strip() else None


def _changed_files(patch_plan: Dict[str, Any], execution_result: Dict[str, Any]) -> List[Dict[str, Any]]:
    by_path: Dict[str, Dict[str, Any]] = {}
    for patch in patch_plan.get("patches", []) or []:
        if not isinstance(patch, dict):
            continue
        path = _patch_file(patch)
        if not path:
            continue
        by_path[path] = {
            "file": path,
            "operation": patch.get("operation") or "patch",
            "status": "planned",
            "risk_level": patch.get("risk_level"),
            "changes": list(patch.get("changes") or []),
        }

    for item in execution_result.get("files", []) or []:
        if not isinstance(item, dict):
            continue
        path = item.get("file")
        if not isinstance(path, str) or not path.strip():
            continue
        record = by_path.setdefault(path, {"file": path, "changes": []})
        record.update(
            {
                "operation": item.get("operation") or record.get("operation") or "patch",
                "status": item.get("status") or record.get("status"),
                "applied": item.get("applied"),
                "dry_run": item.get("dry_run"),
                "preview": item.get("preview"),
                "approval_required": item.get("approval_required"),
                "real_write": item.get("real_write"),
                "mode": item.get("mode"),
            }
        )

    return list(by_path.values())


def _change_plan(patch_plan: Dict[str, Any]) -> List[Dict[str, Any]]:
    result = []
    for patch in patch_plan.get("patches", []) or []:
        if not isinstance(patch, dict):
            continue
        result.append(
            {
                "file": _patch_file(patch),
                "operation": patch.get("operation") or "patch",
                "reason": patch.get("reason"),
                "changes": list(patch.get("changes") or []),
                "risk_level": patch.get("risk_level"),
            }
        )
    return result


def _test_commands(plan: Dict[str, Any], verification_result: Dict[str, Any]) -> List[str]:
    commands = []
    commands.extend(plan.get("test_commands") or [])
    preview = verification_result.get("verify_preview") if isinstance(verification_result, dict) else {}
    if isinstance(preview, dict):
        commands.extend(preview.get("commands") or [])
    test_result = verification_result.get("test_result") if isinstance(verification_result, dict) else {}
    if isinstance(test_result, dict):
        for item in test_result.get("commands", []) or []:
            if isinstance(item, dict):
                commands.append(item.get("command"))
            elif isinstance(item, str):
                commands.append(item)
    return _list_strings(commands)


def _risk_summary(review: Dict[str, Any], execution_result: Dict[str, Any], verification_result: Dict[str, Any], artifacts: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "task_level": artifacts.get("task_level"),
        "risk_level": artifacts.get("risk_level"),
        "review_risk_level": review.get("risk_level"),
        "review_approved": review.get("approved"),
        "review_issues": list(review.get("issues") or []),
        "execution_mode": execution_result.get("mode"),
        "verification_passed": verification_result.get("passed"),
        "verification_mode": verification_result.get("mode"),
        "blocked_reason": artifacts.get("blocked_reason") or artifacts.get("last_error"),
    }


def _affected_stack(changed_files: List[Dict[str, Any]], located_files: Dict[str, Any], plan: Dict[str, Any]) -> str:
    metadata = plan.get("metadata") if isinstance(plan.get("metadata"), dict) else {}
    scope = metadata.get("conduit_scope")
    if scope in {"frontend", "backend", "fullstack"}:
        return scope

    paths = []
    paths.extend(item.get("file") for item in changed_files if isinstance(item, dict))
    for item in located_files.get("files", []) or []:
        if isinstance(item, dict):
            paths.append(item.get("relative_path") or item.get("path"))
    has_frontend = any(str(path or "").replace("\\", "/").startswith("frontend/") for path in paths)
    has_backend = any(str(path or "").replace("\\", "/").startswith("backend/") for path in paths)
    if has_frontend and has_backend:
        return "fullstack"
    if has_backend:
        return "backend"
    return "frontend" if has_frontend else "unknown"


def _classification(requirement_dsl: Dict[str, Any], artifacts: Dict[str, Any]) -> Optional[str]:
    task_level = artifacts.get("task_level")
    if isinstance(task_level, str) and task_level:
        return task_level
    requirement_type = str(requirement_dsl.get("requirement_type") or "").lower()
    if "l2" in requirement_type:
        return "L2"
    if "l1" in requirement_type:
        return "L1"
    return None


def _draft_status(state_status: str, review: Dict[str, Any], execution_result: Dict[str, Any], verification_result: Dict[str, Any], artifacts: Dict[str, Any]) -> str:
    if state_status in {"PAUSED", "FAILED"} or artifacts.get("blocked_reason"):
        return "blocked"
    if review.get("approved") is False:
        return "blocked"
    if execution_result.get("executed") is False:
        return "blocked"
    if verification_result.get("passed") is False:
        return "blocked"
    if verification_result.get("passed") is None:
        return "preview"
    return "ready"


def generate_pr_draft(
    state_status: str,
    user_input: str,
    artifacts: Dict[str, Any],
    matched_skill: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    artifacts = artifacts if isinstance(artifacts, dict) else {}
    requirement_dsl = artifacts.get("requirement_dsl") if isinstance(artifacts.get("requirement_dsl"), dict) else {}
    plan = artifacts.get("plan") if isinstance(artifacts.get("plan"), dict) else {}
    located_files = artifacts.get("located_files") if isinstance(artifacts.get("located_files"), dict) else {}
    patch_plan = artifacts.get("patch_plan") if isinstance(artifacts.get("patch_plan"), dict) else {}
    review = artifacts.get("review") if isinstance(artifacts.get("review"), dict) else {}
    execution_result = artifacts.get("execution_result") if isinstance(artifacts.get("execution_result"), dict) else {}
    verification_result = artifacts.get("verification_result") if isinstance(artifacts.get("verification_result"), dict) else {}
    repo_profile = artifacts.get("repo_profile") if isinstance(artifacts.get("repo_profile"), dict) else {}
    skill_match = artifacts.get("skill_match") if isinstance(artifacts.get("skill_match"), dict) else {}
    matched_skill = matched_skill if isinstance(matched_skill, dict) else {}

    changed_files = _changed_files(patch_plan, execution_result)
    title = plan.get("task_name") or requirement_dsl.get("task_name") or user_input or "Agent generated change"
    coverage = build_acceptance_criteria_coverage(requirement_dsl, review, verification_result)
    status = _draft_status(state_status, review, execution_result, verification_result, artifacts)
    draft = {
        "status": status,
        "title": title,
        "summary": patch_plan.get("summary") or review.get("summary") or "Agent generated PR draft.",
        "requirement_id": requirement_dsl.get("requirement_id"),
        "requirement_type": requirement_dsl.get("requirement_type"),
        "matched_skill_id": skill_match.get("matched_skill_id") or matched_skill.get("id"),
        "changed_files": changed_files,
        "change_plan": _change_plan(patch_plan),
        "acceptance_criteria_coverage": coverage,
        "test_commands": _test_commands(plan, verification_result),
        "test_result": verification_result.get("test_result"),
        "risk_summary": _risk_summary(review, execution_result, verification_result, artifacts),
        "manual_checklist": [
            "Review generated patch preview before any real write.",
            "Confirm acceptance criteria coverage with a human reviewer.",
            "Run the listed verification commands in the target repo before merging.",
        ],
        "rollback_plan": [
            "Revert the files listed in changed_files.",
            "Re-run the listed verification commands after rollback.",
        ],
    }

    if repo_profile.get("repo_type") == "conduit":
        draft["conduit"] = {
            "affected_stack": _affected_stack(changed_files, located_files, plan),
            "key_files": list(repo_profile.get("key_files") or []),
            "classification": _classification(requirement_dsl, artifacts),
        }

    return draft
