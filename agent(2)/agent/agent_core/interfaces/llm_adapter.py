import json
import os
from typing import Any, Dict, Optional

from agent_core.prompts.action_prompt_builder import build_action_prompt
from agent_core.observability.llm_metrics import build_llm_call_metric, now_ms


ACTION_DECISION_ALIASES = {
    "plan_task": "make_plan",
    "locate_files": "locate_files",
    "draft_patch": "generate_patch",
    "validate_patch": "validate_patch",
    "review_patch": "review_patch",
    "execute_patch": "execute_patch",
    "verify_result": "verify_result",
    "summarize_result": "finish",
    "stop": "finish",
}
ACTION_DECISION_MIN_CONFIDENCE = 0.5


class BaseLLMAdapter:
    def generate(self, prompt: str, system_prompt: Optional[str] = None, temperature: float = 0.2) -> dict:
        raise NotImplementedError

    def decide_action(self, state, available_actions, model_info):
        raise NotImplementedError

    def decide_action_with_llm(self, state, available_actions, model_info):
        return {
            "ok": False,
            "error": "llm_action_decision_not_supported",
        }


class MockLLMAdapter(BaseLLMAdapter):
    def generate(self, prompt: str, system_prompt: Optional[str] = None, temperature: float = 0.2) -> dict:
        return {
            "ok": True,
            "provider": "mock",
            "model": "mock-llm",
            "text": "OK",
        }

    def decide_action(self, state, available_actions, model_info) -> Dict[str, Any]:
        action_names = {action["name"] for action in available_actions}
        sequence = [
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
        target_tool = sequence[min(state.current_step, len(sequence) - 1)]

        if target_tool not in action_names:
            return {
                "thought": "Target action is not available",
                "tool": "finish",
                "args": {
                    "reason": "Target action unavailable",
                    "selected_model": model_info["model"],
                },
            }

        prompt = build_action_prompt(state, available_actions, model_info)
        thought = "Mock adapter selected the next action"
        args: Dict[str, Any] = {"selected_model": model_info["model"], "thought": thought, "prompt_preview": prompt[:500]}

        if target_tool == "analyze_requirement":
            args["requirement"] = state.user_input
        elif target_tool == "select_skill":
            args["requirement"] = state.user_input
        elif target_tool == "make_plan":
            args["matched_skill"] = state.matched_skill
            args["runtime_instructions"] = list(state.instructions)
        elif target_tool == "locate_files":
            args["plan"] = state.artifacts.get("plan")
            args["matched_skill"] = state.matched_skill
        elif target_tool == "generate_patch":
            args["plan"] = state.artifacts.get("plan")
            args["located_files"] = state.artifacts.get("located_files")
            args["matched_skill"] = state.matched_skill
        elif target_tool == "validate_patch":
            args["patch_plan"] = state.artifacts.get("patch_plan")
            args["repo_profile"] = state.artifacts.get("repo_profile")
        elif target_tool == "review_patch":
            args["plan"] = state.artifacts.get("plan")
            args["located_files"] = state.artifacts.get("located_files")
            args["patch_plan"] = state.artifacts.get("patch_plan")
            args["validation_result"] = state.artifacts.get("validation_result")
        elif target_tool == "execute_patch":
            args["patch_plan"] = state.artifacts.get("patch_plan")
            args["review"] = state.artifacts.get("review")
        elif target_tool == "verify_result":
            args["plan"] = state.artifacts.get("plan")
            args["execution_result"] = state.artifacts.get("execution_result")
        elif target_tool == "finish":
            args["summary"] = "Agent task completed successfully"

        return {"thought": thought, "tool": target_tool, "args": args}


class DoubaoLLMAdapter(BaseLLMAdapter):
    provider = "doubao"

    def __init__(self, api_key: Optional[str] = None, endpoint: Optional[str] = None, base_url: Optional[str] = None):
        self.api_key = api_key if api_key is not None else os.getenv("DOUBAO_API_KEY")
        self.endpoint = endpoint if endpoint is not None else os.getenv("DOUBAO_ENDPOINT")
        self.base_url = base_url or os.getenv("DOUBAO_BASE_URL", "https://ark.cn-beijing.volces.com/api/v3")

    def generate(self, prompt: str, system_prompt: Optional[str] = None, temperature: float = 0.2) -> dict:
        if not self.api_key:
            return {
                "ok": False,
                "provider": self.provider,
                "model": self.endpoint,
                "text": "",
                "error": "DOUBAO_API_KEY is required",
            }
        if not self.endpoint:
            return {
                "ok": False,
                "provider": self.provider,
                "model": None,
                "text": "",
                "error": "DOUBAO_ENDPOINT is required",
            }

        try:
            from openai import OpenAI
        except ImportError:
            return {
                "ok": False,
                "provider": self.provider,
                "model": self.endpoint,
                "text": "",
                "error": "openai package is required for DoubaoLLMAdapter",
            }

        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        try:
            client = OpenAI(api_key=self.api_key, base_url=self.base_url)
            response = client.chat.completions.create(
                model=self.endpoint,
                messages=messages,
                temperature=temperature,
            )
            text = response.choices[0].message.content or ""
            raw = response.model_dump() if hasattr(response, "model_dump") else None
            return {
                "ok": True,
                "provider": self.provider,
                "model": self.endpoint,
                "text": text,
                "raw": raw,
            }
        except Exception as exc:
            return {
                "ok": False,
                "provider": self.provider,
                "model": self.endpoint,
                "text": "",
                "error": str(exc),
            }

    def decide_action(self, state, available_actions, model_info):
        return MockLLMAdapter().decide_action(state, available_actions, model_info)

    def decide_action_with_llm(self, state, available_actions, model_info):
        return _decide_action_with_generate(self, state, available_actions, model_info)


def get_default_llm_adapter() -> BaseLLMAdapter:
    if os.getenv("AGENT_LLM_PROVIDER", "mock").lower() == "doubao":
        return DoubaoLLMAdapter()
    return MockLLMAdapter()


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


def _latest_observation(state) -> dict:
    history = getattr(state, "history", []) or []
    if not history:
        return {}
    item = history[-1]
    if not isinstance(item, dict):
        return {}
    observation = item.get("observation")
    return observation if isinstance(observation, dict) else {}


def _artifact_dict(artifacts: dict, key: str) -> dict:
    value = artifacts.get(key) if isinstance(artifacts, dict) else None
    return value if isinstance(value, dict) else {}


def _preferred_next_action(artifacts: dict) -> str:
    patch_plan = _artifact_dict(artifacts, "patch_plan")
    validation_result = _artifact_dict(artifacts, "validation_result")
    review = _artifact_dict(artifacts, "review")
    execution_result = _artifact_dict(artifacts, "execution_result")
    verification_result = _artifact_dict(artifacts, "verification_result")
    if verification_result:
        return "summarize_result"
    if execution_result:
        return "verify_result"
    if review:
        return "execute_patch"
    if validation_result:
        return "review_patch"
    if patch_plan.get("summary") and patch_plan.get("patches"):
        return "validate_patch"
    if _artifact_dict(artifacts, "located_files"):
        return "draft_patch"
    if _artifact_dict(artifacts, "plan"):
        return "locate_files"
    return "plan_task"


def _build_action_selector_prompt(state, model_info) -> str:
    artifacts = getattr(state, "artifacts", {}) or {}
    context = artifacts.get("latest_agent_context") if isinstance(artifacts, dict) else {}
    if not isinstance(context, dict):
        context = {}

    payload = {
        "task": getattr(state, "user_input", ""),
        "status": getattr(state, "status", ""),
        "current_step": getattr(state, "current_step", 0),
        "matched_skill": getattr(state, "matched_skill", None),
        "plan": artifacts.get("plan"),
        "located_files": artifacts.get("located_files"),
        "patch_plan": artifacts.get("patch_plan"),
        "validation_result": artifacts.get("validation_result"),
        "review": artifacts.get("review"),
        "execution_result": artifacts.get("execution_result"),
        "verification_result": artifacts.get("verification_result"),
        "preferred_next_action": _preferred_next_action(artifacts),
        "last_observation": _latest_observation(state),
        "latest_context": {
            "agent_name": context.get("agent_name"),
            "current_node_id": context.get("current_node_id"),
            "source_node_ids": context.get("source_node_ids", []),
            "budget_report": context.get("budget_report", {}),
            "privacy_report": context.get("privacy_report", {}),
        },
        "model_info": model_info,
        "allowed_actions": list(ACTION_DECISION_ALIASES.keys()),
    }
    return (
        "You are a controlled action selector for an engineering agent.\n"
        "Choose exactly one next action from allowed_actions.\n"
        "Prefer preferred_next_action when it is present in the state.\n"
        "Do not choose draft_patch when patch_plan already has non-empty patches and summary.\n"
        "Choose validate_patch before review_patch whenever validation_result is missing.\n"
        "Return strict JSON only, with no markdown and no extra text:\n"
        '{"action":"locate_files","reason":"...","confidence":0.82}\n\n'
        "State:\n"
        f"{json.dumps(payload, ensure_ascii=False)}"
    )


def _decide_action_with_generate(adapter, state, available_actions, model_info):
    system_prompt = (
        "You select the next safe action for an agent runtime. "
        "Return strict JSON only. The action must be from the allowed whitelist."
    )
    prompt = _build_action_selector_prompt(state, model_info)
    started_ms = now_ms()
    result = adapter.generate(
        prompt=prompt,
        system_prompt=system_prompt,
        temperature=0.0,
    )
    metric = build_llm_call_metric("action_decision", result, prompt=prompt, system_prompt=system_prompt, started_ms=started_ms)
    if not result.get("ok"):
        return {
            "ok": False,
            "error": result.get("error") or "llm_generate_failed",
            "provider": result.get("provider"),
            "model": result.get("model"),
            "llm_metrics": [metric],
        }

    try:
        data = json.loads(_strip_json_fence(result.get("text", "")))
    except (TypeError, ValueError) as exc:
        return {
            "ok": False,
            "error": f"invalid_json: {exc}",
            "raw_text": result.get("text", ""),
            "provider": result.get("provider"),
            "model": result.get("model"),
            "llm_metrics": [metric],
        }

    if not isinstance(data, dict):
        return {
            "ok": False,
            "error": "json_root_not_object",
            "raw_text": result.get("text", ""),
            "provider": result.get("provider"),
            "model": result.get("model"),
            "llm_metrics": [metric],
        }

    action_name = data.get("action")
    reason = data.get("reason", "")
    confidence = data.get("confidence")
    if action_name not in ACTION_DECISION_ALIASES:
        return {
            "ok": False,
            "error": "unknown_action",
            "rejected_action": action_name,
            "reason": reason,
            "confidence": confidence,
            "provider": result.get("provider"),
            "model": result.get("model"),
            "llm_metrics": [metric],
        }
    if not isinstance(confidence, (int, float)) or confidence < ACTION_DECISION_MIN_CONFIDENCE:
        return {
            "ok": False,
            "error": "low_confidence",
            "rejected_action": action_name,
            "reason": reason,
            "confidence": confidence,
            "provider": result.get("provider"),
            "model": result.get("model"),
            "llm_metrics": [metric],
        }

    internal_tool = ACTION_DECISION_ALIASES[action_name]
    available_names = {action.get("name") for action in available_actions}
    if internal_tool not in available_names:
        return {
            "ok": False,
            "error": "mapped_tool_unavailable",
            "rejected_action": action_name,
            "reason": reason,
            "confidence": confidence,
            "provider": result.get("provider"),
            "model": result.get("model"),
            "llm_metrics": [metric],
        }

    return {
        "ok": True,
        "action": action_name,
        "tool": internal_tool,
        "reason": reason,
        "confidence": float(confidence),
        "provider": result.get("provider"),
        "model": result.get("model"),
        "llm_metrics": [metric],
    }
