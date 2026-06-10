from .base import HookResult


class DangerousEditGuard:
    DANGEROUS_TOOLS = {"apply_patch", "edit_file", "write_file"}

    def check(self, state, action) -> HookResult:
        tool_name = action.get("tool") if isinstance(action, dict) else None
        if tool_name not in self.DANGEROUS_TOOLS:
            return HookResult(ok=True)

        args = action.get("args", {}) if isinstance(action, dict) else {}
        target_file = None
        for key in ("path", "file", "filepath", "target_file"):
            if key in args and args[key]:
                target_file = args[key]
                break

        if not target_file:
            return HookResult(ok=False, reason="Edit action missing target file", should_stop=True)

        blocked = (
            "/tests/" in target_file
            or "\\tests\\" in target_file
            or target_file.endswith(".test.js")
            or target_file.endswith(".spec.js")
            or target_file.endswith(".test.ts")
            or target_file.endswith(".spec.ts")
            or target_file.split("/")[-1] in {"package-lock.json", "yarn.lock", "pnpm-lock.yaml"}
            or target_file.split("\\")[-1] in {"package-lock.json", "yarn.lock", "pnpm-lock.yaml"}
            or target_file.endswith(".env")
            or ".git/" in target_file
            or ".git\\" in target_file
            or "node_modules/" in target_file
            or "node_modules\\" in target_file
        )

        if blocked:
            return HookResult(ok=False, reason=f"Dangerous edit blocked: {target_file}", should_stop=True)

        return HookResult(ok=True)
