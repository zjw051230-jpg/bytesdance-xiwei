from .base import HookResult


class MaxStepGuard:
    def check(self, state, action) -> HookResult:
        if state.current_step >= state.max_steps:
            return HookResult(ok=False, reason="Max step limit reached", should_stop=True)
        return HookResult(ok=True)
