import os
from typing import Any, Dict

from agent_core.actions import get_action
from agent_core.actions.registry import get_all_actions
from agent_core.interfaces.llm_adapter import get_default_llm_adapter
from agent_core.skills.registry import match_skill


FIXED_ACTION_SEQUENCE = [
    "analyze_requirement",
    "select_skill",
    "make_plan",
    "locate_files",
    "generate_patch",
    "validate_patch",
    "review_patch",
    "execute_patch",
    "verify_result",
    "finish",
]


def _build_action(tool_name: str, state, model_info) -> Dict[str, Any]:
    action = get_action(tool_name)
    if action is None:
        return {"tool": tool_name, "args": {"input": state.user_input, "selected_model": model_info["model"]}}

    args = {"input": state.user_input, "selected_model": model_info["model"]}
    if tool_name == "select_skill":
        dsl = state.artifacts.get("requirement_dsl") if isinstance(state.artifacts, dict) else None
        matched = match_skill(state.user_input, requirement_dsl=dsl if isinstance(dsl, dict) else None)
        state.matched_skill = matched.get("skill")
        args["matched_skill"] = matched
    if tool_name == "make_plan":
        args["matched_skill"] = state.matched_skill
        args["runtime_instructions"] = list(state.instructions)
        args["selected_model"] = model_info["model"]
    if tool_name == "locate_files":
        args["plan"] = state.artifacts.get("plan")
        args["matched_skill"] = state.matched_skill
        args["selected_model"] = model_info["model"]
    if tool_name == "generate_patch":
        args["user_input"] = state.user_input
        args["matched_skill"] = state.matched_skill
        args["plan"] = state.artifacts.get("plan")
        args["located_files"] = state.artifacts.get("located_files")
        args["selected_model"] = model_info["model"]
    if tool_name == "validate_patch":
        args["patch_plan"] = state.artifacts.get("patch_plan")
        args["repo_profile"] = state.artifacts.get("repo_profile")
        args["selected_model"] = model_info["model"]
    if tool_name == "verify_result":
        args["plan"] = state.artifacts.get("plan")
        args["execution_result"] = state.artifacts.get("execution_result")
        args["selected_model"] = model_info["model"]
    return {"tool": action["name"], "args": args}


def _attach_decision(action: Dict[str, Any], decision: Dict[str, Any]) -> Dict[str, Any]:
    enriched = dict(action)
    enriched["__decision"] = decision
    return enriched


def _artifact_dict(state, key: str) -> Dict[str, Any]:
    artifacts = state.artifacts if isinstance(getattr(state, "artifacts", None), dict) else {}
    value = artifacts.get(key)
    return value if isinstance(value, dict) else {}


def _has_valid_patch_plan(state) -> bool:
    patch_plan = _artifact_dict(state, "patch_plan")
    return bool(patch_plan.get("summary")) and bool(patch_plan.get("patches"))


def _has_review(state) -> bool:
    return bool(_artifact_dict(state, "review"))


def _has_validation_result(state) -> bool:
    return bool(_artifact_dict(state, "validation_result"))


def _has_execution_result(state) -> bool:
    return bool(_artifact_dict(state, "execution_result"))


def _has_verification_result(state) -> bool:
    return bool(_artifact_dict(state, "verification_result"))


def _preferred_tool_for_state(state):
    if _has_verification_result(state):
        return "finish"
    if _has_execution_result(state):
        return "verify_result"
    if _has_review(state):
        return "execute_patch"
    if _has_validation_result(state):
        return "review_patch"
    if _has_valid_patch_plan(state):
        return "validate_patch"
    return None


def _apply_state_progression(state, tool_name: str):
    preferred_tool = _preferred_tool_for_state(state)
    if preferred_tool is None or preferred_tool == tool_name:
        return None

    stale_tools = {
        "generate_patch",
        "validate_patch",
        "review_patch",
        "execute_patch",
        "verify_result",
    }
    if tool_name in stale_tools:
        return {
            "tool": preferred_tool,
            "reason": f"existing_artifact_requires: {preferred_tool}",
        }
    return None


def _fixed_action_for_step(state, model_info, source: str = "mock", rejected_action=None, reason: str = "") -> Dict[str, Any]:
    target_tool = FIXED_ACTION_SEQUENCE[min(state.current_step, len(FIXED_ACTION_SEQUENCE) - 1)]
    progression = _apply_state_progression(state, target_tool)
    if progression is not None:
        rejected_action = rejected_action or target_tool
        reason = reason or progression["reason"]
        target_tool = progression["tool"]
    action = _build_action(target_tool, state, model_info)
    decision = {
        "decision_source": source,
        "selected_action": target_tool,
        "selected_tool": action.get("tool"),
        "rejected_action": rejected_action,
        "reason": reason or "Fixed action sequence selected the next action",
        "confidence": 1.0 if source == "mock" else None,
    }
    return _attach_decision(action, decision)


def fixed_next_action(state, model_info, source: str = "fallback", rejected_action=None, reason: str = "") -> Dict[str, Any]:
    return _fixed_action_for_step(
        state=state,
        model_info=model_info,
        source=source,
        rejected_action=rejected_action,
        reason=reason,
    )


def _has_matched_skill(state) -> bool:
    return isinstance(getattr(state, "matched_skill", None), dict)


def _has_artifact(state, key: str) -> bool:
    return bool(_artifact_dict(state, key))


def _dependency_fallback_tool(state, selected_tool: str):
    checks = [
        ("make_plan", "matched_skill", _has_matched_skill, "select_skill"),
        ("locate_files", "plan", lambda item: _has_artifact(item, "plan"), "make_plan"),
        ("generate_patch", "located_files", lambda item: _has_artifact(item, "located_files"), "locate_files"),
        ("validate_patch", "patch_plan", lambda item: _has_artifact(item, "patch_plan"), "generate_patch"),
        ("review_patch", "validation_result", lambda item: _has_artifact(item, "validation_result"), "validate_patch"),
        ("execute_patch", "review_result", lambda item: _has_artifact(item, "review"), "review_patch"),
        ("verify_result", "execution_result", lambda item: _has_artifact(item, "execution_result"), "execute_patch"),
    ]
    order = [item[0] for item in checks]
    if selected_tool not in order:
        return None
    for tool_name, dependency_name, predicate, fallback_tool in checks[: order.index(selected_tool) + 1]:
        if not predicate(state):
            return {
                "tool": fallback_tool,
                "dependency": dependency_name,
                "blocked_tool": tool_name,
            }
    return None


def _dependency_fallback_action(state, model_info, selected_action: str, selected_tool: str, dependency: dict) -> Dict[str, Any]:
    fallback_tool = dependency["tool"]
    action = _build_action(fallback_tool, state, model_info)
    reason = f"missing_dependency: {dependency['dependency']}"
    return _attach_decision(
        action,
        {
            "decision_source": "fallback",
            "selected_action": fallback_tool,
            "selected_tool": action.get("tool"),
            "rejected_action": selected_action or selected_tool,
            "reason": reason,
            "confidence": None,
        },
    )


def _progression_fallback_action(state, model_info, selected_action: str, selected_tool: str, progression: dict) -> Dict[str, Any]:
    fallback_tool = progression["tool"]
    action = _build_action(fallback_tool, state, model_info)
    return _attach_decision(
        action,
        {
            "decision_source": "fallback",
            "selected_action": fallback_tool,
            "selected_tool": action.get("tool"),
            "rejected_action": selected_action or selected_tool,
            "reason": progression["reason"],
            "confidence": None,
        },
    )


def decide_next_action(state, model_info) -> Dict[str, Any]:
    step = state.current_step

    if os.getenv("AGENT_TEST_UNKNOWN_TOOL") == "1" and step == 1:
        return _build_action("bad_tool", state, model_info)

    if os.getenv("AGENT_TEST_LOOP") == "1":
        return _build_action("analyze_requirement", state, model_info)

    if os.getenv("AGENT_TEST_SAFE_EDIT") == "1" and step == 1:
        return {"tool": "apply_patch", "args": {"path": "frontend/src/pages/Article.jsx", "patch": "mock patch", "selected_model": model_info["model"]}}

    if os.getenv("AGENT_TEST_DANGEROUS_EDIT") == "1" and step == 1:
        return {"tool": "apply_patch", "args": {"path": "frontend/src/pages/Article.test.js", "patch": "mock patch", "selected_model": model_info["model"]}}

    adapter = get_default_llm_adapter()
    available_actions = get_all_actions()
    if os.getenv("AGENT_LLM_ACTION_DECISION") == "1":
        decision_result = adapter.decide_action_with_llm(state, available_actions, model_info)
        if decision_result.get("ok") is True:
            progression = _apply_state_progression(state, decision_result["tool"])
            if progression is not None:
                return _progression_fallback_action(
                    state,
                    model_info,
                    selected_action=decision_result.get("action"),
                    selected_tool=decision_result.get("tool"),
                    progression=progression,
                )
            dependency = _dependency_fallback_tool(state, decision_result["tool"])
            if dependency is not None:
                return _dependency_fallback_action(
                    state,
                    model_info,
                    selected_action=decision_result.get("action"),
                    selected_tool=decision_result.get("tool"),
                    dependency=dependency,
                )
            result = _build_action(decision_result["tool"], state, model_info)
            result = _attach_decision(
                result,
                {
                    "decision_source": "llm",
                    "selected_action": decision_result.get("action"),
                    "selected_tool": decision_result.get("tool"),
                    "rejected_action": None,
                    "reason": decision_result.get("reason", ""),
                    "confidence": decision_result.get("confidence"),
                    "provider": decision_result.get("provider"),
                    "model": decision_result.get("model"),
                    "llm_metrics": decision_result.get("llm_metrics", []),
                },
            )
        else:
            fallback = fixed_next_action(
                state,
                model_info,
                source="fallback",
                rejected_action=decision_result.get("rejected_action"),
                reason=decision_result.get("error") or "LLM action decision failed",
            )
            fallback.setdefault("__decision", {})["llm_metrics"] = decision_result.get("llm_metrics", [])
            return fallback
    else:
        result = adapter.decide_action(state, available_actions, model_info)
        progression = _apply_state_progression(state, result.get("tool"))
        if progression is not None:
            result = _progression_fallback_action(
                state,
                model_info,
                selected_action=result.get("tool"),
                selected_tool=result.get("tool"),
                progression=progression,
            )
            return result
        if result.get("tool") and result.get("tool") in {action["name"] for action in available_actions}:
            result = _attach_decision(
                result,
                {
                    "decision_source": "mock",
                    "selected_action": result.get("tool"),
                    "selected_tool": result.get("tool"),
                    "rejected_action": None,
                    "reason": result.get("thought") or "Mock/fixed action decision",
                    "confidence": 1.0,
                },
            )

    if result.get("tool") and result.get("tool") not in {action["name"] for action in available_actions}:
        fallback = {
            "thought": "Target action is not available",
            "tool": "finish",
            "args": {"reason": "Target action unavailable", "selected_model": model_info["model"]},
            "__decision": {
                "decision_source": "fallback",
                "selected_action": "finish",
                "selected_tool": "finish",
                "rejected_action": result.get("tool"),
                "reason": "Target action unavailable",
                "confidence": None,
            },
        }
        return fallback

    if result.get("tool") == "select_skill":
        dsl = state.artifacts.get("requirement_dsl") if isinstance(state.artifacts, dict) else None
        matched = match_skill(state.user_input, requirement_dsl=dsl if isinstance(dsl, dict) else None)
        state.matched_skill = matched.get("skill")
        result.setdefault("args", {})["matched_skill"] = matched

    if result.get("args") is not None and "selected_model" not in result["args"]:
        result["args"]["selected_model"] = model_info["model"]

    return result
