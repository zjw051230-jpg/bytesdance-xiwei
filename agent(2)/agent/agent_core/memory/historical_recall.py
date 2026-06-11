from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from agent_core.interfaces.context_http_adapter import get_default_context_http_adapter


SECRET_PATTERNS = (
    re.compile(r"api[_-]?key", re.IGNORECASE),
    re.compile(r"secret", re.IGNORECASE),
    re.compile(r"token", re.IGNORECASE),
    re.compile(r"password", re.IGNORECASE),
    re.compile(r"\.env", re.IGNORECASE),
)


def _safe_string(value: Any) -> Optional[str]:
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text:
        return None
    if any(pattern.search(text) for pattern in SECRET_PATTERNS):
        return None
    return text


def _safe_list(values: Any) -> List[str]:
    result = []
    for item in values or []:
        text = _safe_string(item)
        if text and text not in result:
            result.append(text)
    return result


def _tokens(values: Any) -> set:
    parts = []
    if isinstance(values, str):
        parts.append(values)
    elif isinstance(values, list):
        parts.extend(str(item) for item in values if item is not None)
    elif isinstance(values, dict):
        parts.extend(str(item) for item in values.values() if item is not None)
    text = " ".join(parts).lower().replace("/", " ").replace("\\", " ").replace("-", " ").replace("_", " ")
    return {token.strip(".,;:!?()[]{}'\"") for token in text.split() if len(token.strip(".,;:!?()[]{}'\"")) >= 3}


def build_recall_query(requirement_dsl: Optional[Dict[str, Any]], matched_skill: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    dsl = requirement_dsl if isinstance(requirement_dsl, dict) else {}
    skill = matched_skill if isinstance(matched_skill, dict) else {}
    return {
        "requirement_id": dsl.get("requirement_id"),
        "task_name": dsl.get("task_name"),
        "user_story": dsl.get("user_story"),
        "requirement_type": dsl.get("requirement_type"),
        "skill_hint": dsl.get("skill_hint"),
        "target_modules": list(dsl.get("target_modules") or []),
        "acceptance_criteria": list(dsl.get("acceptance_criteria") or []),
        "matched_skill": {
            "id": skill.get("id") or skill.get("name"),
            "name": skill.get("name") or skill.get("id"),
        } if skill else {},
    }


def _states_dir() -> Path:
    override = os.getenv("AGENT_STATE_DIR")
    if override:
        return Path(override).expanduser().resolve()
    return Path(__file__).resolve().parents[1] / "storage" / "states"


def _load_state_candidates() -> List[Dict[str, Any]]:
    directory = _states_dir()
    if not directory.exists():
        return []
    candidates = []
    for path in sorted(directory.glob("*.json"), key=lambda item: item.stat().st_mtime, reverse=True):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, ValueError):
            continue
        if isinstance(data, dict):
            candidates.append({"source": "state_file", "state_file": str(path), "data": data})
    return candidates


def _memory_candidates(memory_adapter) -> List[Dict[str, Any]]:
    candidates = []
    for case in getattr(memory_adapter, "cases", []) or []:
        if isinstance(case, dict):
            candidates.append({"source": "memory_case", "data": case})
    for event in getattr(memory_adapter, "events", []) or []:
        if isinstance(event, dict):
            candidates.append({"source": "memory_event", "data": event})
    return candidates


def _event_candidates(event_adapter) -> List[Dict[str, Any]]:
    candidates = []
    for task_id, events in getattr(event_adapter, "events_by_task", {}).items():
        for event in events or []:
            if isinstance(event, dict):
                candidates.append({"source": "domain_event", "task_id": task_id, "data": event})
    return candidates


def _context_safe_candidates(task_id: str = "") -> List[Dict[str, Any]]:
    if os.getenv("USE_CONTEXT_HTTP") != "1":
        return []
    adapter = get_default_context_http_adapter()
    if not task_id:
        return []
    response = adapter.read_safe_events(task_id)
    if not isinstance(response, dict) or response.get("ok") is False:
        return []
    events = response.get("events") or response.get("data", {}).get("events") if isinstance(response.get("data"), dict) else response.get("events")
    candidates = []
    for event in events or []:
        if isinstance(event, dict):
            candidates.append({"source": "context_safe_event", "task_id": task_id, "data": event})
    return candidates


def _artifact_from_candidate(candidate: Dict[str, Any]) -> Dict[str, Any]:
    data = candidate.get("data") if isinstance(candidate.get("data"), dict) else {}
    if candidate.get("source") == "state_file":
        artifacts = data.get("artifacts") if isinstance(data.get("artifacts"), dict) else {}
        return {
            "task_id": data.get("task_id"),
            "user_input": data.get("user_input"),
            "requirement_dsl": artifacts.get("requirement_dsl") if isinstance(artifacts.get("requirement_dsl"), dict) else {},
            "skill_match": artifacts.get("skill_match") if isinstance(artifacts.get("skill_match"), dict) else {},
            "matched_skill": data.get("matched_skill") if isinstance(data.get("matched_skill"), dict) else artifacts.get("matched_skill") if isinstance(artifacts.get("matched_skill"), dict) else {},
            "plan": artifacts.get("plan") if isinstance(artifacts.get("plan"), dict) else {},
            "located_files": artifacts.get("located_files") if isinstance(artifacts.get("located_files"), dict) else {},
            "patch_plan": artifacts.get("patch_plan") if isinstance(artifacts.get("patch_plan"), dict) else {},
            "review": artifacts.get("review") if isinstance(artifacts.get("review"), dict) else {},
            "verification_result": artifacts.get("verification_result") if isinstance(artifacts.get("verification_result"), dict) else {},
        }

    payload = data.get("payload") if isinstance(data.get("payload"), dict) else {}
    if "plan" in payload or "located_files" in payload or "patch_plan" in payload or "review" in payload or "verification_result" in payload:
        return {
            "task_id": data.get("task_id") or candidate.get("task_id"),
            "plan": payload.get("plan") if isinstance(payload.get("plan"), dict) else {},
            "located_files": payload.get("located_files") if isinstance(payload.get("located_files"), dict) else {},
            "patch_plan": payload.get("patch_plan") if isinstance(payload.get("patch_plan"), dict) else {},
            "review": payload.get("review") if isinstance(payload.get("review"), dict) else {},
            "verification_result": payload.get("verification_result") if isinstance(payload.get("verification_result"), dict) else {},
            "skill_match": payload.get("skill_match") if isinstance(payload.get("skill_match"), dict) else {},
        }

    summary = data.get("summary") if isinstance(data.get("summary"), dict) else {}
    skill = data.get("skill") if isinstance(data.get("skill"), dict) else {}
    return {
        "task_id": data.get("task_id") or candidate.get("task_id"),
        "user_input": data.get("requirement"),
        "matched_skill": skill,
        "skill_match": summary.get("skill_match") if isinstance(summary.get("skill_match"), dict) else {},
        "plan": {"task_name": summary.get("plan_summary")} if summary.get("plan_summary") else {},
        "review": {"risk_level": summary.get("review_risk_level")} if summary.get("review_risk_level") else {},
        "verification_result": {"test_result": summary.get("test_result")} if summary.get("test_result") else {},
    }


def _score(query: Dict[str, Any], artifact: Dict[str, Any]) -> Tuple[int, List[str]]:
    matched = []
    score = 0
    dsl = artifact.get("requirement_dsl") if isinstance(artifact.get("requirement_dsl"), dict) else {}
    skill = artifact.get("matched_skill") if isinstance(artifact.get("matched_skill"), dict) else {}
    skill_match = artifact.get("skill_match") if isinstance(artifact.get("skill_match"), dict) else {}
    plan = artifact.get("plan") if isinstance(artifact.get("plan"), dict) else {}

    if query.get("requirement_type") and query.get("requirement_type") == dsl.get("requirement_type"):
        score += 20
        matched.append("requirement_type")

    query_skill = (query.get("matched_skill") or {}).get("id") or query.get("skill_hint")
    artifact_skill = skill.get("id") or skill.get("name") or skill_match.get("matched_skill_id")
    if query_skill and artifact_skill and str(query_skill).lower() == str(artifact_skill).lower():
        score += 30
        matched.append("skill_id")

    query_modules = set(_safe_list(query.get("target_modules")))
    artifact_modules = set(_safe_list(dsl.get("target_modules") or plan.get("target_modules") or plan.get("target_files_hint")))
    if query_modules and artifact_modules and query_modules.intersection(artifact_modules):
        score += 25
        matched.append("target_modules")

    query_acceptance = _tokens(query.get("acceptance_criteria"))
    artifact_acceptance = _tokens(dsl.get("acceptance_criteria") or plan.get("acceptance_criteria"))
    if query_acceptance and artifact_acceptance:
        overlap = query_acceptance.intersection(artifact_acceptance)
        if overlap:
            score += min(20, len(overlap) * 4)
            matched.append("acceptance_criteria")

    query_text = _tokens([query.get("task_name"), query.get("user_story")])
    artifact_text = _tokens([dsl.get("task_name"), dsl.get("user_story"), artifact.get("user_input"), plan.get("task_name")])
    overlap = query_text.intersection(artifact_text)
    if overlap:
        score += min(20, len(overlap) * 3)
        matched.append("keywords")

    return score, matched


def _file_hints(located_files: Dict[str, Any], patch_plan: Dict[str, Any]) -> List[str]:
    hints = []
    for item in located_files.get("files", []) or []:
        if not isinstance(item, dict):
            continue
        text = _safe_string(item.get("relative_path") or item.get("path"))
        if text and text not in hints:
            hints.append(text)
    for patch in patch_plan.get("patches", []) or []:
        if not isinstance(patch, dict):
            continue
        text = _safe_string(patch.get("file") or patch.get("path"))
        if text and text not in hints:
            hints.append(text)
    return hints


def _test_commands(plan: Dict[str, Any], verification_result: Dict[str, Any]) -> List[str]:
    commands = []
    commands.extend(_safe_list(plan.get("test_commands")))
    preview = verification_result.get("verify_preview") if isinstance(verification_result.get("verify_preview"), dict) else {}
    commands.extend(_safe_list(preview.get("commands")))
    test_result = verification_result.get("test_result") if isinstance(verification_result.get("test_result"), dict) else {}
    for item in test_result.get("commands", []) or []:
        if isinstance(item, dict):
            commands.extend(_safe_list([item.get("command")]))
    return commands


def _known_risks(review: Dict[str, Any], patch_plan: Dict[str, Any]) -> List[str]:
    risks = []
    risks.extend(_safe_list(review.get("issues")))
    if review.get("risk_level") in {"medium", "high"}:
        risks.append(f"Previous review risk level: {review.get('risk_level')}")
    for patch in patch_plan.get("patches", []) or []:
        if isinstance(patch, dict) and patch.get("risk_level") in {"medium", "high"}:
            path = _safe_string(patch.get("file") or patch.get("path")) or "changed file"
            risks.append(f"{path} had {patch.get('risk_level')} patch risk")
    return _safe_list(risks)


def _patch_strategy_hint(patch_plan: Dict[str, Any]) -> Dict[str, Any]:
    patches = []
    for patch in patch_plan.get("patches", []) or []:
        if not isinstance(patch, dict):
            continue
        path = _safe_string(patch.get("file") or patch.get("path"))
        if not path:
            continue
        patches.append(
            {
                "file": path,
                "operation": patch.get("operation") or "patch",
                "risk_level": patch.get("risk_level"),
                "change_count": len(patch.get("changes") or []),
            }
        )
    return {"patches": patches} if patches else {}


def _case_from_artifact(candidate: Dict[str, Any], artifact: Dict[str, Any], score: int, matched_fields: List[str]) -> Dict[str, Any]:
    plan = artifact.get("plan") if isinstance(artifact.get("plan"), dict) else {}
    located_files = artifact.get("located_files") if isinstance(artifact.get("located_files"), dict) else {}
    patch_plan = artifact.get("patch_plan") if isinstance(artifact.get("patch_plan"), dict) else {}
    review = artifact.get("review") if isinstance(artifact.get("review"), dict) else {}
    verification_result = artifact.get("verification_result") if isinstance(artifact.get("verification_result"), dict) else {}
    dsl = artifact.get("requirement_dsl") if isinstance(artifact.get("requirement_dsl"), dict) else {}
    return {
        "source": candidate.get("source"),
        "task_id": artifact.get("task_id") or candidate.get("task_id"),
        "requirement_id": dsl.get("requirement_id"),
        "similarity_score": score,
        "matched_fields": matched_fields,
        "reusable_plan_hints": _safe_list([plan.get("task_name")] + list(plan.get("steps") or [])),
        "reusable_file_hints": _file_hints(located_files, patch_plan),
        "reusable_test_commands": _test_commands(plan, verification_result),
        "known_risks": _known_risks(review, patch_plan),
        "patch_strategy_hint": _patch_strategy_hint(patch_plan),
    }


def _merge_hints(cases: List[Dict[str, Any]]) -> Dict[str, Any]:
    plan_hints = []
    file_hints = []
    test_commands = []
    risks = []
    patch_hints = []
    for case in cases:
        plan_hints.extend(case.get("reusable_plan_hints") or [])
        file_hints.extend(case.get("reusable_file_hints") or [])
        test_commands.extend(case.get("reusable_test_commands") or [])
        risks.extend(case.get("known_risks") or [])
        if case.get("patch_strategy_hint"):
            patch_hints.append(case["patch_strategy_hint"])
    return {
        "reusable_plan_hints": _safe_list(plan_hints),
        "reusable_file_hints": _safe_list(file_hints),
        "reusable_test_commands": _safe_list(test_commands),
        "known_risks": _safe_list(risks),
        "patch_strategy_hints": patch_hints,
    }


def recall_historical_cases(
    requirement_dsl: Optional[Dict[str, Any]],
    matched_skill: Optional[Dict[str, Any]],
    memory_adapter=None,
    event_adapter=None,
    task_id: str = "",
    top_k: int = 5,
) -> Dict[str, Any]:
    query = build_recall_query(requirement_dsl, matched_skill)
    candidates = []
    candidates.extend(_memory_candidates(memory_adapter))
    candidates.extend(_event_candidates(event_adapter))
    candidates.extend(_load_state_candidates())
    candidates.extend(_context_safe_candidates(task_id))

    seen = set()
    cases = []
    current_requirement_id = query.get("requirement_id")
    for candidate in candidates:
        artifact = _artifact_from_candidate(candidate)
        dsl = artifact.get("requirement_dsl") if isinstance(artifact.get("requirement_dsl"), dict) else {}
        if current_requirement_id and dsl.get("requirement_id") == current_requirement_id:
            continue
        score, matched_fields = _score(query, artifact)
        if score <= 0:
            continue
        case = _case_from_artifact(candidate, artifact, score, matched_fields)
        fingerprint = json.dumps(
            {
                "source": case.get("source"),
                "task_id": case.get("task_id"),
                "requirement_id": case.get("requirement_id"),
                "files": case.get("reusable_file_hints"),
            },
            sort_keys=True,
        )
        if fingerprint in seen:
            continue
        seen.add(fingerprint)
        cases.append(case)

    cases.sort(key=lambda item: (-int(item.get("similarity_score") or 0), str(item.get("task_id") or "")))
    cases = cases[:top_k]
    merged = _merge_hints(cases)
    best_score = cases[0]["similarity_score"] if cases else 0
    matched = []
    for case in cases:
        for field in case.get("matched_fields") or []:
            if field not in matched:
                matched.append(field)
    return {
        "recalled_cases": cases,
        "similarity_score": best_score,
        "matched_fields": matched,
        **merged,
    }
