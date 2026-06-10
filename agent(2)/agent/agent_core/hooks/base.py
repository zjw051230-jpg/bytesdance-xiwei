from dataclasses import dataclass


@dataclass
class HookResult:
    ok: bool
    reason: str = ""
    should_stop: bool = False
