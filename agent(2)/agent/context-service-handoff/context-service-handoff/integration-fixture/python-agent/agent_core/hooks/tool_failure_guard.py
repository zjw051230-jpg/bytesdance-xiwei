from .base import HookResult


class ToolFailureGuard:
    def check(self, state, action, observation) -> HookResult:
        if isinstance(observation, dict) and observation.get("ok") is False:
            return HookResult(
                ok=False,
                reason=observation.get("error", "Tool execution failed"),
                should_stop=True,
            )
        return HookResult(ok=True)
