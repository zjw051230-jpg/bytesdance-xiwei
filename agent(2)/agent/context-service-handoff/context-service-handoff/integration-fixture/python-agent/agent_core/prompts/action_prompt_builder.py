from typing import Any, Dict, List


def _build_context_summary(state) -> str:
    context = (state.artifacts or {}).get("latest_agent_context") or {}
    if not isinstance(context, dict):
        context = {}

    return "\n".join(
        [
            f"- agent_name: {context.get('agent_name')}",
            f"- current_node_id: {context.get('current_node_id')}",
            f"- source_node_ids: {context.get('source_node_ids', [])}",
            f"- budget_report: {context.get('budget_report', {})}",
            f"- privacy_report: {context.get('privacy_report', {})}",
        ]
    )


def build_action_prompt(state, available_actions: List[Dict[str, Any]], model_info: Dict[str, Any]) -> str:
    artifact_keys = list((state.artifacts or {}).keys())
    context_summary = _build_context_summary(state)
    action_lines = []
    for action in available_actions:
        action_lines.append(
            f"- name: {action.get('name', '')}\n  description: {action.get('description', '')}\n  category: {action.get('category', '')}"
        )

    prompt = f"""You are an engineering agent. Select the next action from the current state.

Task:
{state.user_input}

Current state:
- status: {getattr(state, 'status', 'UNKNOWN')}
- current_step: {getattr(state, 'current_step', 0)}
- instructions: {state.instructions}
- matched_skill: {state.matched_skill}
- artifact_keys: {artifact_keys}

Latest agent context:
{context_summary}

Available actions:
{chr(10).join(action_lines)}

Model info:
- provider: {model_info.get('provider', 'unknown')}
- model: {model_info.get('model', 'unknown')}
- budget_mode: {model_info.get('budget_mode', 'unknown')}
- estimated_cost_level: {model_info.get('estimated_cost_level', 'unknown')}

Output format:
Return JSON only:
{{
  "thought": "...",
  "tool": "...",
  "args": {{...}}
}}

Constraints:
1. tool must come from available_actions.
2. Do not output extra text.
3. If uncertain, choose finish and explain why.
4. Do not directly edit files unless selecting an explicit edit or execute action.
"""
    return prompt
