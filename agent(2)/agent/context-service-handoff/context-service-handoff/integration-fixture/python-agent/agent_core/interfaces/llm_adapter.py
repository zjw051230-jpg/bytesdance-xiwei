import json
import os
import urllib.error
import urllib.request
from typing import Any, Dict

from prompts.action_prompt_builder import build_action_prompt


class BaseLLMAdapter:
    def decide_action(self, state, available_actions, model_info):
        raise NotImplementedError


class MockLLMAdapter(BaseLLMAdapter):
    def decide_action(self, state, available_actions, model_info) -> Dict[str, Any]:
        action_names = {action["name"] for action in available_actions}
        sequence = [
            "analyze_requirement",
            "select_skill",
            "make_plan",
            "locate_files",
            "generate_patch",
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
        elif target_tool == "review_patch":
            args["plan"] = state.artifacts.get("plan")
            args["located_files"] = state.artifacts.get("located_files")
            args["patch_plan"] = state.artifacts.get("patch_plan")
        elif target_tool == "execute_patch":
            args["patch_plan"] = state.artifacts.get("patch_plan")
            args["review"] = state.artifacts.get("review")
        elif target_tool == "verify_result":
            args["plan"] = state.artifacts.get("plan")
            args["execution_result"] = state.artifacts.get("execution_result")
        elif target_tool == "finish":
            args["summary"] = "Agent task completed successfully"

        return {"thought": thought, "tool": target_tool, "args": args}


class RealLLMAdapter(BaseLLMAdapter):
    def __init__(
        self,
        api_key: str,
        model: str,
        base_url: str = "https://ark.cn-beijing.volces.com/api/v3",
        timeout: float = 30.0,
        temperature: float = 0.0,
    ):
        if not api_key:
            raise ValueError("api_key is required")
        if not model:
            raise ValueError("model is required")
        self.api_key = api_key
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.temperature = temperature

    def decide_action(self, state, available_actions, model_info) -> Dict[str, Any]:
        prompt = build_action_prompt(state, available_actions, model_info)
        content = self._chat_completion([
            {
                "role": "system",
                "content": (
                    "You are a strict JSON action router for an engineering agent. "
                    "Choose the next tool from available_actions. Prefer the pipeline order "
                    "by current_step: 0 analyze_requirement, 1 select_skill, 2 make_plan, "
                    "3 locate_files, 4 generate_patch, 5 review_patch, 6 execute_patch, "
                    "7 verify_result, 8 finish. Return JSON only."
                ),
            },
            {"role": "user", "content": prompt},
        ])
        parsed = parse_json_object(content)
        tool = parsed.get("tool")
        action_names = {action["name"] for action in available_actions}
        if tool not in action_names:
            return {
                "thought": "Real LLM returned an unavailable tool; finishing safely.",
                "tool": "finish",
                "args": {
                    "reason": "Unavailable tool returned by real LLM",
                    "selected_model": self.model,
                    "raw_tool": tool,
                },
            }
        args = parsed.get("args") if isinstance(parsed.get("args"), dict) else {}
        args.setdefault("selected_model", self.model)
        args.setdefault("llm_provider", "ark")
        return {
            "thought": parsed.get("thought", "Real LLM selected the next action"),
            "tool": tool,
            "args": args,
        }

    def _chat_completion(self, messages):
        request = urllib.request.Request(
            f"{self.base_url}/chat/completions",
            data=json.dumps({
                "model": self.model,
                "messages": messages,
                "temperature": self.temperature,
            }).encode("utf-8"),
            headers={
                "authorization": f"Bearer {self.api_key}",
                "content-type": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            body = error.read().decode("utf-8") if error.fp else ""
            raise RuntimeError(f"LLM request failed with status {error.code}: {body[:500]}") from error
        except urllib.error.URLError as error:
            raise RuntimeError(f"LLM request failed: {error.reason}") from error

        return payload.get("choices", [{}])[0].get("message", {}).get("content", "")


def parse_json_object(content: str) -> Dict[str, Any]:
    if not isinstance(content, str) or not content.strip():
        raise ValueError("LLM response is empty")
    stripped = content.strip()
    if stripped.startswith("```"):
        stripped = stripped.strip("`")
        if stripped.startswith("json"):
            stripped = stripped[4:].strip()
    try:
        parsed = json.loads(stripped)
    except json.JSONDecodeError:
        start = stripped.find("{")
        end = stripped.rfind("}")
        if start < 0 or end < start:
            raise
        parsed = json.loads(stripped[start:end + 1])
    if not isinstance(parsed, dict):
        raise ValueError("LLM response JSON must be an object")
    return parsed


def get_default_llm_adapter() -> BaseLLMAdapter:
    if os.getenv("USE_REAL_LLM") == "1":
        return RealLLMAdapter(
            api_key=os.getenv("ARK_API_KEY", ""),
            model=os.getenv("ARK_MODEL") or os.getenv("ARK_ENDPOINT_ID", ""),
            base_url=os.getenv("ARK_BASE_URL", "https://ark.cn-beijing.volces.com/api/v3"),
        )
    return MockLLMAdapter()
