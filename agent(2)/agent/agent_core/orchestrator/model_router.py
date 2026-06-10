def select_model(state) -> dict:
    task_level = state.artifacts.get("task_level", "L1")
    risk_level = state.artifacts.get("risk_level", "low")
    budget_mode = state.artifacts.get("budget_mode", "balanced")
    step = state.current_step

    if step == 0:
        phase = "clarify"
    elif step == 1:
        phase = "skill_route"
    elif step == 2:
        phase = "plan"
    else:
        phase = "finish"

    cheap_model = {
        "provider": "volcengine",
        "model": "doubao-seed-2.0-lite",
        "reason": "cheap default for clarify/skill_route/finish",
        "budget_mode": budget_mode,
        "estimated_cost_level": "low",
    }

    if phase in {"clarify", "skill_route", "finish"}:
        return cheap_model

    if budget_mode == "low_cost":
        return {
            **cheap_model,
            "reason": "low_cost override applied",
            "budget_mode": budget_mode,
        }

    if task_level == "L1" and risk_level == "low":
        return {
            "provider": "volcengine",
            "model": "doubao-seed-2.0-lite",
            "reason": "L1 low-risk plan uses cheap model",
            "budget_mode": budget_mode,
            "estimated_cost_level": "low",
        }

    return {
        "provider": "volcengine",
        "model": "strong-coder-placeholder",
        "reason": "plan phase requires stronger model for this task",
        "budget_mode": budget_mode,
        "estimated_cost_level": "medium",
    }
