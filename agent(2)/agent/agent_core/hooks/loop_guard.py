from .base import HookResult


class LoopGuard:
    def check(self, state, action) -> HookResult:
        tool_name = action.get("tool") if isinstance(action, dict) else None
        recent_history = list(state.history[-3:])

        if len(recent_history) < 3:
            return HookResult(ok=True)

        repeated = True
        for item in recent_history:
            history_action = item.get("action", {}) if isinstance(item, dict) else {}
            history_tool = history_action.get("tool") if isinstance(history_action, dict) else None
            if history_tool != tool_name:
                repeated = False
                break

        if repeated:
            return HookResult(ok=False, reason=f"Loop detected: repeated tool '{tool_name}'", should_stop=True)
        return HookResult(ok=True)
