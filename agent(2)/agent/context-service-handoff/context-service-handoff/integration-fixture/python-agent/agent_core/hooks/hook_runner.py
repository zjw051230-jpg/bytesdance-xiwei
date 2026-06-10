from .base import HookResult
from .dangerous_edit_guard import DangerousEditGuard
from .empty_observation_guard import EmptyObservationGuard
from .loop_guard import LoopGuard
from .max_step_guard import MaxStepGuard
from .tool_failure_guard import ToolFailureGuard
from .unknown_tool_guard import UnknownToolGuard


def run_pre_hooks(state, action) -> HookResult:
    guards = [MaxStepGuard(), UnknownToolGuard(), LoopGuard(), DangerousEditGuard()]
    for guard in guards:
        result = guard.check(state, action)
        if not result.ok:
            return result
    return HookResult(ok=True)


def run_post_hooks(state, action, observation) -> HookResult:
    guards = [EmptyObservationGuard(), ToolFailureGuard()]
    for guard in guards:
        result = guard.check(state, action, observation)
        if not result.ok:
            return result
    return HookResult(ok=True)
