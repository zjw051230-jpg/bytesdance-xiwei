import os
from typing import Any, Dict

from actions import get_action
from actions.registry import get_all_actions
from interfaces.llm_adapter import get_default_llm_adapter
from skills.registry import match_skill


def _build_action(tool_name: str, state, model_info) -> Dict[str, Any]:
    action = get_action(tool_name)
    if action is None:
        return {"tool": tool_name, "args": {"input": state.user_input, "selected_model": model_info["model"]}}

    args = {"input": state.user_input, "selected_model": model_info["model"]}
    if tool_name == "select_skill":
        matched = match_skill(state.user_input)
        state.matched_skill = matched.get("skill") if matched.get("matched") else None
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
    if tool_name == "verify_result":
        args["plan"] = state.artifacts.get("plan")
        args["execution_result"] = state.artifacts.get("execution_result")
        args["selected_model"] = model_info["model"]
    return {"tool": action["name"], "args": args}


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
    result = adapter.decide_action(state, available_actions, model_info)

    if result.get("tool") and result.get("tool") not in {action["name"] for action in available_actions}:
        fallback = {"thought": "Target action is not available", "tool": "finish", "args": {"reason": "Target action unavailable", "selected_model": model_info["model"]}}
        return fallback

    if result.get("tool") == "select_skill":
        matched = match_skill(state.user_input)
        state.matched_skill = matched.get("skill") if matched.get("matched") else None
        result.setdefault("args", {})["matched_skill"] = matched

    if result.get("args") is not None and "selected_model" not in result["args"]:
        result["args"]["selected_model"] = model_info["model"]

    return result
