from actions import get_action_names

from .base import HookResult


class UnknownToolGuard:
    EXTRA_TOOLS = {"edit_file", "write_file"}

    def check(self, state, action) -> HookResult:
        tool_name = action.get("tool", "")
        allowed_tools = set(get_action_names()) | self.EXTRA_TOOLS
        if tool_name not in allowed_tools:
            return HookResult(ok=False, reason=f"Unknown tool: {tool_name}", should_stop=True)
        return HookResult(ok=True)
