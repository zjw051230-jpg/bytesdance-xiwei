import json
import os
from typing import Any, Dict, List, Optional

from agent_core.interfaces.llm_adapter import get_default_llm_adapter
from agent_core.observability.llm_metrics import build_llm_call_metric, now_ms
from agent_core.skills.registry import resolve_skill


def _generic_plan(user_input: str, runtime_instructions: Optional[List[str]] = None) -> Dict[str, Any]:
    return {
        "task_name": "Generate implementation plan",
        "skill_id": "generic",
        "skill_name": None,
        "scope": "unknown",
        "steps": ["Clarify requirement", "Locate relevant modules", "Propose implementation plan"],
        "target_files_hint": [],
        "target_modules": [],
        "target_file_patterns": [],
        "context_rules": [],
        "acceptance_criteria": ["Requirement needs clarification"],
        "acceptance_template": ["Requirement needs clarification"],
        "test_commands": [],
        "risk_level": "low",
        "runtime_instructions": list(runtime_instructions or []),
    }


def _recall_plan_hints(historical_recall: Optional[Dict[str, Any]]) -> Dict[str, List[str]]:
    if not isinstance(historical_recall, dict):
        return {"plan_hints": [], "file_hints": [], "test_commands": []}
    return {
        "plan_hints": [item for item in historical_recall.get("reusable_plan_hints", []) or [] if isinstance(item, str)],
        "file_hints": [item for item in historical_recall.get("reusable_file_hints", []) or [] if isinstance(item, str)],
        "test_commands": [item for item in historical_recall.get("reusable_test_commands", []) or [] if isinstance(item, str)],
    }


def _apply_recall_to_plan(plan: Dict[str, Any], historical_recall: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    hints = _recall_plan_hints(historical_recall)
    if not any(hints.values()):
        return plan
    result = dict(plan)
    target_modules = list(result.get("target_modules") or [])
    target_files_hint = list(result.get("target_files_hint") or [])
    target_file_patterns = list(result.get("target_file_patterns") or [])
    for item in hints["file_hints"]:
        if item not in target_modules:
            target_modules.append(item)
        if item not in target_files_hint:
            target_files_hint.append(item)
        if item not in target_file_patterns:
            target_file_patterns.append(item)
    test_commands = list(result.get("test_commands") or [])
    for command in hints["test_commands"]:
        if command not in test_commands:
            test_commands.append(command)
    metadata = dict(result.get("metadata") or {})
    metadata["historical_recall"] = {
        "similarity_score": historical_recall.get("similarity_score") if isinstance(historical_recall, dict) else 0,
        "matched_fields": list(historical_recall.get("matched_fields", []) or []) if isinstance(historical_recall, dict) else [],
        "reusable_plan_hints": hints["plan_hints"],
    }
    result.update(
        {
            "target_modules": target_modules,
            "target_files_hint": target_files_hint,
            "target_file_patterns": target_file_patterns,
            "test_commands": test_commands,
            "metadata": metadata,
        }
    )
    if hints["plan_hints"]:
        steps = list(result.get("steps") or [])
        for hint in hints["plan_hints"][:3]:
            step = f"Consider historical plan hint: {hint}"
            if step not in steps:
                steps.append(step)
        result["steps"] = steps
    return result


def _strip_json_fence(text: str) -> str:
    stripped = (text or "").strip()
    if stripped.startswith("```"):
        lines = stripped.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        stripped = "\n".join(lines).strip()
    return stripped


def _skill_default_risk(skill: Optional[Dict[str, Any]], fallback: str = "low") -> str:
    if not isinstance(skill, dict):
        return fallback
    risk_rules = skill.get("risk_rules") if isinstance(skill.get("risk_rules"), dict) else {}
    value = risk_rules.get("default") or fallback
    return value if value in {"low", "medium", "high"} else fallback


def _is_conduit_repo(repo_profile: Optional[Dict[str, Any]]) -> bool:
    return isinstance(repo_profile, dict) and repo_profile.get("repo_type") == "conduit"


def _conduit_scope(requirement_type: str = "", matched_skill: Optional[Dict[str, Any]] = None) -> str:
    matched_skill = matched_skill if isinstance(matched_skill, dict) else {}
    value = str(requirement_type or "").lower()
    if "l2" in value or "fullstack" in value:
        return "fullstack"
    if "backend" in value:
        return "backend"
    if "frontend" in value:
        return "frontend"
    skill_category = str((matched_skill or {}).get("category") or "").lower()
    skill_types = {str(item).lower() for item in (matched_skill or {}).get("requirement_types", []) or []}
    if skill_category == "fullstack" or "fullstack" in skill_types:
        return "fullstack"
    return "frontend"


def _conduit_patterns(matched_skill: Optional[Dict[str, Any]], scope: str) -> List[str]:
    skill = matched_skill if isinstance(matched_skill, dict) else {}
    frontend = list(skill.get("conduit_frontend_patterns") or [])
    backend = list(skill.get("conduit_backend_patterns") or [])
    if scope == "frontend":
        return frontend or ["frontend/src"]
    if scope == "backend":
        return backend or ["backend/src", "backend/models", "backend/routes", "backend/controllers"]
    return (backend or ["backend/src", "backend/models", "backend/routes", "backend/controllers"]) + (
        frontend or ["frontend/src"]
    )


def _conduit_test_commands(matched_skill: Optional[Dict[str, Any]], repo_profile: Optional[Dict[str, Any]]) -> List[str]:
    matched_skill = matched_skill if isinstance(matched_skill, dict) else {}
    preferred = list(matched_skill.get("conduit_test_commands") or ["npm test", "npm run test", "npm run lint"])
    available = repo_profile.get("available_scripts", {}) if isinstance(repo_profile, dict) else {}
    script_names = set()
    if isinstance(available, dict):
        for scripts in available.values():
            if isinstance(scripts, dict):
                script_names.update(str(name) for name in scripts)
    result = []
    for command in preferred:
        if command == "npm test" and "test" in script_names:
            result.append(command)
        elif command == "npm run test" and "test" in script_names:
            result.append(command)
        elif command == "npm run lint" and "lint" in script_names:
            result.append(command)
    return result


def _l3_kind(requirement_type: str = "", matched_skill: Optional[Dict[str, Any]] = None) -> Optional[str]:
    text = " ".join(
        [
            str(requirement_type or ""),
            str((matched_skill or {}).get("id") or ""),
            str((matched_skill or {}).get("name") or ""),
        ]
    ).lower()
    if "conduit_l3_ambiguous" in text or "clarify-first" in text:
        return "ambiguous"
    if "conduit_l3_conflict" in text or "conflict-detection" in text:
        return "conflict"
    if "conduit_l3_multimodule" in text or "multi-module-planning" in text:
        return "multimodule"
    return None


def _l3_plan(
    requirement_dsl: Dict[str, Any],
    matched_skill: Optional[Dict[str, Any]],
    runtime_instructions: Optional[List[str]] = None,
    repo_profile: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    kind = _l3_kind(requirement_dsl.get("requirement_type"), matched_skill)
    base = {
        "requirement_id": requirement_dsl.get("requirement_id"),
        "task_name": requirement_dsl.get("task_name") or requirement_dsl.get("user_input") or requirement_dsl.get("user_story"),
        "user_story": requirement_dsl.get("user_story") or requirement_dsl.get("user_input"),
        "requirement_type": requirement_dsl.get("requirement_type"),
        "task_level": requirement_dsl.get("task_level") or "L3",
        "skill_id": (matched_skill or {}).get("id"),
        "skill_name": requirement_dsl.get("skill_hint") or (matched_skill or {}).get("name"),
        "scope": requirement_dsl.get("requirement_type") or "conduit_l3",
        "target_files_hint": [],
        "target_modules": [],
        "target_file_patterns": [],
        "context_rules": list((matched_skill or {}).get("context_rules") or []),
        "acceptance_criteria": list(requirement_dsl.get("acceptance_criteria") or []),
        "acceptance_template": list((matched_skill or {}).get("acceptance_template") or requirement_dsl.get("acceptance_criteria") or []),
        "constraints": list(requirement_dsl.get("constraints") or []),
        "test_commands": list(requirement_dsl.get("test_commands") or (matched_skill or {}).get("default_test_commands") or []),
        "risk_level": requirement_dsl.get("risk_level") or _skill_default_risk(matched_skill, "high"),
        "runtime_instructions": list(runtime_instructions or []),
        "metadata": {
            "planner": "requirement_dsl_l3",
            "skill_id": (matched_skill or {}).get("id"),
            "target_repo": requirement_dsl.get("target_repo"),
            "repo_type": repo_profile.get("repo_type") if isinstance(repo_profile, dict) else None,
            "l3_kind": kind,
            "requires_clarification": True,
            "allow_code_patches": False,
        },
    }

    if kind == "ambiguous":
        base.update(
            {
                "status": "clarification_required",
                "steps": [
                    "Identify possible interpretations of the requested article experience improvement",
                    "Ask clarification questions before selecting modules",
                    "Resume into a concrete Requirement DSL after the user chooses scope",
                ],
                "possible_interpretations": [
                    "Dark mode or theme refresh",
                    "Reading progress indicator",
                    "Typography and spacing improvements",
                    "Article outline or table of contents",
                    "Layout improvements for cover, metadata, and body content",
                ],
                "clarification_questions": [
                    "Which reading-experience improvement should be prioritized: theme, progress, typography, outline, or layout?",
                    "Should the change be frontend-only styling, or can it add saved user preferences or backend data?",
                    "What visual constraints should be preserved from the current Conduit UI?",
                ],
            }
        )
        return base

    if kind == "conflict":
        base.update(
            {
                "status": "blocked",
                "steps": [
                    "Compare requested persistent cover image behavior with forbidden modules",
                    "Explain why database, backend API, and editor form constraints block persistence",
                    "Ask user to choose a feasible alternative before patch generation",
                ],
                "conflict_reason": (
                    "A persistent article cover image requires storage, API read/write support, and an editor input, "
                    "but the requirement explicitly forbids modifying the database, backend interface, and frontend form."
                ),
                "feasible_alternatives": [
                    "Frontend-only mock display using an existing article field or static placeholder",
                    "Allow backend/model/form changes for persistent cover image support",
                    "Limit the task to article detail layout preparation without storing cover image data",
                ],
                "clarification_questions": [
                    "Should this be a non-persistent frontend-only mock, or may the forbidden modules be modified?",
                    "If persistence is required, which constraint can be relaxed first?",
                ],
            }
        )
        return base

    base.update(
        {
            "status": "planning_paused",
            "steps": [
                "Decompose rating into backend, frontend, test, and risk workstreams",
                "Clarify voting policy before broad cross-stack code changes",
                "Stage implementation after policy decisions are confirmed",
            ],
            "target_modules": list((matched_skill or {}).get("target_modules") or []),
            "target_file_patterns": list((matched_skill or {}).get("target_file_patterns") or []),
            "staged_plan": {
                "backend": [
                    "Add rating storage model or fields after deciding aggregate and per-user vote policy",
                    "Add read/write API endpoints or article serializer fields",
                ],
                "frontend": [
                    "Display average rating and vote count on article detail",
                    "Add authenticated 1-5 star input with loading and error states",
                ],
                "test": [
                    "Cover model/API behavior for create, update, and duplicate vote policy",
                    "Cover frontend rendering and submit interaction",
                ],
                "risk": [
                    "One-user-one-vote and anonymous-user behavior are underspecified",
                    "Average rating and rating update semantics affect schema and idempotency",
                    "Authentication requirements may change API authorization behavior",
                ],
            },
            "clarification_questions": [
                "Should each authenticated user have exactly one rating per article?",
                "Can anonymous users rate, or only signed-in users?",
                "Should users be able to update their rating after submitting?",
                "Should the article show average rating, total vote count, or both?",
            ],
        }
    )
    return base


def _plan_from_skill(
    user_input: str,
    matched_skill: Dict[str, Any],
    runtime_instructions: Optional[List[str]] = None,
    repo_profile: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    matched_skill = matched_skill if isinstance(matched_skill, dict) else {}
    target_modules = list(matched_skill.get("target_modules") or [])
    target_file_patterns = list(matched_skill.get("target_file_patterns") or target_modules)
    acceptance = list(matched_skill.get("acceptance_template") or [])
    test_commands = list(matched_skill.get("default_test_commands") or [])
    conduit_scope = None
    if _is_conduit_repo(repo_profile):
        conduit_scope = _conduit_scope("", matched_skill)
        target_file_patterns = _conduit_patterns(matched_skill, conduit_scope)
        target_modules = list(target_file_patterns)
        test_commands = _conduit_test_commands(matched_skill, repo_profile)
        acceptance = acceptance + list(matched_skill.get("conduit_acceptance_checks") or [])

    return {
        "task_name": matched_skill.get("description") or "Generate implementation plan",
        "skill_id": matched_skill.get("id"),
        "skill_name": matched_skill.get("name"),
        "scope": matched_skill.get("category") or (matched_skill.get("requirement_types") or ["unknown"])[0],
        "steps": [
            "Read requirement and matched skill",
            "Locate files using skill target modules and file patterns",
            "Prepare patch plan using skill patch strategy",
            "Review against skill acceptance template and risk rules",
            "Execute through configured repo adapter",
            "Verify with skill default test commands",
        ],
        "target_files_hint": target_modules,
        "target_modules": target_modules,
        "target_file_patterns": target_file_patterns,
        "context_rules": list(matched_skill.get("context_rules") or []),
        "acceptance_criteria": acceptance or ["Requirement intent is satisfied"],
        "acceptance_template": acceptance,
        "test_commands": test_commands,
        "risk_level": _skill_default_risk(matched_skill),
        "runtime_instructions": list(runtime_instructions or []),
        "metadata": {
            "planner": "skill_registry",
            "skill_id": matched_skill.get("id"),
            "repo_type": repo_profile.get("repo_type") if isinstance(repo_profile, dict) else None,
            "conduit_scope": conduit_scope,
        },
    }


def _rule_plan(
    user_input: str,
    matched_skill: Optional[Dict[str, Any]],
    runtime_instructions: Optional[List[str]] = None,
    repo_profile: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    matched_skill = resolve_skill(matched_skill) or {}
    if isinstance(matched_skill, dict) and matched_skill.get("id") != "generic":
        return _plan_from_skill(user_input, matched_skill, runtime_instructions, repo_profile=repo_profile)
    return _generic_plan(user_input, runtime_instructions)


def _dsl_plan(
    requirement_dsl: Dict[str, Any],
    matched_skill: Optional[Dict[str, Any]],
    runtime_instructions: Optional[List[str]] = None,
    repo_profile: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    requirement_dsl = requirement_dsl if isinstance(requirement_dsl, dict) else {}
    matched_skill = resolve_skill(matched_skill) or {}
    l3_kind = _l3_kind(requirement_dsl.get("requirement_type"), matched_skill)
    if l3_kind:
        return _l3_plan(requirement_dsl, matched_skill, runtime_instructions, repo_profile=repo_profile)

    skill_name = requirement_dsl.get("skill_hint")
    if not skill_name:
        skill_name = matched_skill.get("name")

    skill_target_modules = matched_skill.get("target_modules")
    skill_acceptance = matched_skill.get("acceptance_template")
    skill_tests = matched_skill.get("default_test_commands")

    target_modules = list(requirement_dsl.get("target_modules") or skill_target_modules or [])
    acceptance_criteria = list(requirement_dsl.get("acceptance_criteria") or skill_acceptance or [])
    constraints = list(requirement_dsl.get("constraints") or [])
    test_commands = list(requirement_dsl.get("test_commands") or skill_tests or [])
    conduit_scope = None
    if _is_conduit_repo(repo_profile):
        conduit_scope = _conduit_scope(requirement_dsl.get("requirement_type"), matched_skill)
        conduit_patterns = _conduit_patterns(matched_skill, conduit_scope)
        target_modules = conduit_patterns
        test_commands = list(requirement_dsl.get("test_commands") or _conduit_test_commands(matched_skill, repo_profile))
        acceptance_criteria = acceptance_criteria + list(matched_skill.get("conduit_acceptance_checks") or [])

    return {
        "requirement_id": requirement_dsl.get("requirement_id"),
        "task_name": requirement_dsl.get("task_name") or requirement_dsl.get("user_story"),
        "user_story": requirement_dsl.get("user_story"),
        "requirement_type": requirement_dsl.get("requirement_type"),
        "skill_id": matched_skill.get("id"),
        "skill_name": skill_name or None,
        "scope": requirement_dsl.get("requirement_type") or "dsl",
        "steps": [
            "Read Requirement DSL",
            "Locate target modules from Requirement DSL and matched Skill",
            "Prepare implementation patch plan from Skill patch strategy",
            "Review patch against acceptance criteria, constraints, and Skill risk rules",
            "Execute through configured repo adapter",
            "Verify using Requirement DSL or Skill test commands",
        ],
        "target_files_hint": target_modules,
        "target_modules": target_modules,
        "target_file_patterns": target_modules if conduit_scope else list(matched_skill.get("target_file_patterns") or target_modules),
        "context_rules": list(matched_skill.get("context_rules") or []),
        "acceptance_criteria": acceptance_criteria,
        "acceptance_template": list(skill_acceptance or acceptance_criteria),
        "constraints": constraints,
        "test_commands": test_commands,
        "risk_level": requirement_dsl.get("risk_level") or _skill_default_risk(matched_skill),
        "runtime_instructions": list(runtime_instructions or []),
        "metadata": {
            "planner": "requirement_dsl",
            "skill_id": matched_skill.get("id"),
            "target_repo": requirement_dsl.get("target_repo"),
            "repo_type": repo_profile.get("repo_type") if isinstance(repo_profile, dict) else None,
            "conduit_scope": conduit_scope,
        },
    }


def _create_llm_plan(user_input: str, matched_skill: Optional[Dict[str, Any]], runtime_instructions: Optional[List[str]], llm_adapter=None) -> Dict[str, Any]:
    adapter = llm_adapter or get_default_llm_adapter()
    system_prompt = (
        "You are a planning component. Return JSON only with keys: "
        "plan, intent, risk_level, suggested_files, test_commands."
    )
    prompt = (
        f"Requirement:\n{user_input}\n\n"
        f"Matched skill:\n{matched_skill}\n\n"
        f"Runtime instructions:\n{runtime_instructions or []}\n\n"
        "Return JSON only."
    )
    started_ms = now_ms()
    result = adapter.generate(prompt=prompt, system_prompt=system_prompt, temperature=0.2)
    metric = build_llm_call_metric("planner", result, prompt=prompt, system_prompt=system_prompt, started_ms=started_ms)
    if not result.get("ok"):
        fallback = _rule_plan(user_input, matched_skill, runtime_instructions)
        fallback["metadata"] = {"llm_planner_fallback_reason": result.get("error") or "llm_generate_failed"}
        fallback.setdefault("llm_metrics", []).append(metric)
        return fallback

    try:
        data = json.loads(_strip_json_fence(result.get("text", "")))
    except (TypeError, ValueError) as exc:
        fallback = _rule_plan(user_input, matched_skill, runtime_instructions)
        fallback["metadata"] = {"llm_planner_fallback_reason": f"invalid_json: {exc}"}
        fallback.setdefault("llm_metrics", []).append(metric)
        return fallback

    if not isinstance(data, dict):
        fallback = _rule_plan(user_input, matched_skill, runtime_instructions)
        fallback["metadata"] = {"llm_planner_fallback_reason": "json_root_not_object"}
        fallback.setdefault("llm_metrics", []).append(metric)
        return fallback

    risk_level = data.get("risk_level")
    if risk_level not in {"low", "medium", "high"}:
        fallback = _rule_plan(user_input, matched_skill, runtime_instructions)
        fallback["metadata"] = {"llm_planner_fallback_reason": "invalid_risk_level"}
        fallback.setdefault("llm_metrics", []).append(metric)
        return fallback

    suggested_files = data.get("suggested_files")
    test_commands = data.get("test_commands")
    if not isinstance(suggested_files, list) or not isinstance(test_commands, list):
        fallback = _rule_plan(user_input, matched_skill, runtime_instructions)
        fallback["metadata"] = {"llm_planner_fallback_reason": "invalid_list_fields"}
        fallback.setdefault("llm_metrics", []).append(metric)
        return fallback

    return {
        "task_name": data.get("plan") or "LLM generated implementation plan",
        "skill_id": matched_skill.get("id") if isinstance(matched_skill, dict) else None,
        "skill_name": matched_skill.get("name") if isinstance(matched_skill, dict) else None,
        "scope": "llm",
        "steps": [data.get("plan") or "Follow LLM generated implementation plan"],
        "target_files_hint": [item for item in suggested_files if isinstance(item, str)],
        "acceptance_criteria": [data.get("intent") or "Requirement intent is satisfied"],
        "test_commands": [item for item in test_commands if isinstance(item, str)],
        "risk_level": risk_level,
        "intent": data.get("intent") or "",
        "runtime_instructions": list(runtime_instructions or []),
        "metadata": {
            "planner": "llm",
            "provider": result.get("provider"),
            "model": result.get("model"),
        },
        "llm_metrics": [metric],
    }


def create_plan(
    user_input: str,
    matched_skill: Optional[Dict[str, Any]],
    runtime_instructions: Optional[List[str]] = None,
    llm_adapter=None,
    requirement_dsl: Optional[Dict[str, Any]] = None,
    repo_profile: Optional[Dict[str, Any]] = None,
    historical_recall: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    if isinstance(requirement_dsl, dict):
        return _apply_recall_to_plan(
            _dsl_plan(requirement_dsl, matched_skill, runtime_instructions, repo_profile=repo_profile),
            historical_recall,
        )

    if os.getenv("AGENT_USE_LLM_PLANNER") == "1":
        return _apply_recall_to_plan(
            _create_llm_plan(user_input, matched_skill, runtime_instructions, llm_adapter=llm_adapter),
            historical_recall,
        )

    return _apply_recall_to_plan(
        _rule_plan(user_input, matched_skill, runtime_instructions, repo_profile=repo_profile),
        historical_recall,
    )
