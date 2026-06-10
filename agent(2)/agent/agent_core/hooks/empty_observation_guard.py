from .base import HookResult


class EmptyObservationGuard:
    def check(self, state, action, observation) -> HookResult:
        if observation is None or observation == {}:
            return HookResult(ok=False, reason="Empty observation", should_stop=True)
        return HookResult(ok=True)
