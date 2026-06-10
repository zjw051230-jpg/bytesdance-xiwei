import json
from typing import Any, Dict, List, Optional


DSL_FIELDS = {
    "requirement_id",
    "task_name",
    "user_story",
    "requirement_type",
    "target_repo",
    "target_modules",
    "acceptance_criteria",
    "constraints",
    "skill_hint",
    "test_commands",
    "risk_level",
}

REPLAY_FIELDS = {"mode", "requirement_id", "from_stage", "overrides", "replay_id", "task_id"}


class RequirementDslError(ValueError):
    pass


def _string_list(value: Any, field_name: str) -> List[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value] if value.strip() else []
    if not isinstance(value, list):
        raise RequirementDslError(f"{field_name} must be a string or list of strings")
    result = []
    for item in value:
        if not isinstance(item, str):
            raise RequirementDslError(f"{field_name} must contain only strings")
        if item.strip():
            result.append(item.strip())
    return result


def normalize_requirement_dsl(data: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(data, dict):
        raise RequirementDslError("Requirement DSL root must be a JSON object")

    has_dsl_signal = any(key in data for key in DSL_FIELDS)
    if not has_dsl_signal:
        raise RequirementDslError("JSON input is not a Requirement DSL object")

    task_name = data.get("task_name")
    user_story = data.get("user_story")
    if task_name is not None and not isinstance(task_name, str):
        raise RequirementDslError("task_name must be a string")
    if user_story is not None and not isinstance(user_story, str):
        raise RequirementDslError("user_story must be a string")
    if not (task_name or user_story):
        raise RequirementDslError("Requirement DSL must include task_name or user_story")

    requirement_id = data.get("requirement_id")
    if requirement_id is not None and not isinstance(requirement_id, str):
        raise RequirementDslError("requirement_id must be a string")

    requirement_type = data.get("requirement_type")
    if requirement_type is not None and not isinstance(requirement_type, str):
        raise RequirementDslError("requirement_type must be a string")

    target_repo = data.get("target_repo")
    if target_repo is not None and not isinstance(target_repo, str):
        raise RequirementDslError("target_repo must be a string")

    skill_hint = data.get("skill_hint")
    if skill_hint is not None and not isinstance(skill_hint, str):
        raise RequirementDslError("skill_hint must be a string")

    risk_level = data.get("risk_level") or "low"
    if not isinstance(risk_level, str):
        raise RequirementDslError("risk_level must be a string")
    if risk_level not in {"low", "medium", "high"}:
        raise RequirementDslError("risk_level must be low, medium, or high")

    return {
        "requirement_id": requirement_id or "requirement_dsl",
        "task_name": (task_name or user_story or "").strip(),
        "user_story": (user_story or task_name or "").strip(),
        "requirement_type": (requirement_type or "feature").strip(),
        "target_repo": (target_repo or "").strip(),
        "target_modules": _string_list(data.get("target_modules"), "target_modules"),
        "acceptance_criteria": _string_list(data.get("acceptance_criteria"), "acceptance_criteria"),
        "constraints": _string_list(data.get("constraints"), "constraints"),
        "skill_hint": (skill_hint or "").strip(),
        "test_commands": _string_list(data.get("test_commands"), "test_commands"),
        "risk_level": risk_level,
    }


def parse_requirement_input(raw_input: str) -> Dict[str, Any]:
    text = (raw_input or "").strip()
    if not text:
        return {"kind": "empty", "user_input": ""}

    if not (text.startswith("{") or text.startswith("[")):
        return {"kind": "text", "user_input": text, "requirement_dsl": None}

    try:
        data = json.loads(text)
    except ValueError as exc:
        raise RequirementDslError(f"Invalid JSON DSL: {exc}") from exc

    if isinstance(data, dict) and data.get("mode") == "replay":
        if not any(key in data for key in REPLAY_FIELDS):
            raise RequirementDslError("Replay request is missing replay fields")
        user_input = data.get("user_input") or data.get("requirement_id") or "replay"
        return {"kind": "replay", "user_input": str(user_input), "requirement_dsl": None, "replay_request": data}

    dsl = normalize_requirement_dsl(data)
    user_input = dsl.get("user_story") or dsl.get("task_name") or text
    return {"kind": "dsl", "user_input": user_input, "requirement_dsl": dsl}


def build_acceptance_criteria_coverage(requirement_dsl: Optional[Dict[str, Any]], review_result: Any, verification_result: Any) -> Dict[str, Any]:
    criteria = []
    if isinstance(requirement_dsl, dict):
        criteria = list(requirement_dsl.get("acceptance_criteria") or [])
    review_checks = review_result.get("checks") if isinstance(review_result, dict) else {}
    verification_passed = verification_result.get("passed") if isinstance(verification_result, dict) else None
    covered = bool(review_checks.get("matches_acceptance_criteria")) if isinstance(review_checks, dict) else False
    return {
        "requirement_id": requirement_dsl.get("requirement_id") if isinstance(requirement_dsl, dict) else None,
        "criteria": criteria,
        "covered_count": len(criteria) if covered else 0,
        "total_count": len(criteria),
        "review_matches_acceptance_criteria": covered,
        "verification_passed": verification_passed,
    }
