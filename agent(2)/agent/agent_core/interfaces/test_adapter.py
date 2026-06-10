from __future__ import annotations

import os
import shlex
import shutil
import subprocess
import sys
from pathlib import Path


class BaseTestAdapter:
    def run_tests(self, commands: list[str]) -> dict:
        raise NotImplementedError


class MockTestAdapter(BaseTestAdapter):
    def run_tests(self, commands: list[str]) -> dict:
        return {
            "ok": True,
            "passed": True,
            "commands": [
                {
                    "command": command,
                    "status": "passed",
                    "exit_code": 0,
                    "output": "Mock test passed",
                }
                for command in commands
            ],
        }


class RealTestAdapter(BaseTestAdapter):
    is_real_test_adapter = True

    ALLOWED_PREFIXES = (
        "pytest",
        "python -m unittest",
        "python -c",
        "npm test",
        "npm run test",
        "npm run lint",
        "npm run build",
        "ruff check",
        "mypy",
    )
    BLOCKED_TOKENS = ("cat", "ls", "powershell", "cmd", "rm", "del", "curl", "wget", "git push")
    REDIRECT_TOKENS = (">", "<", "|", "&&", "||", ";")
    EXECUTION_ALLOWED_PREFIXES = (
        "pytest",
        "python -m unittest",
        "python -c",
        "npm test",
        "npm run test",
        "npm run lint",
        "npm run build",
    )

    def __init__(self, working_directory: str, reason: str = "real repository verification preview"):
        self.working_directory = working_directory
        self.reason = reason

    def _is_allowed(self, command: str) -> bool:
        normalized = " ".join((command or "").strip().split())
        lowered = normalized.lower()
        if not normalized:
            return False
        try:
            argv = shlex.split(command)
        except ValueError:
            return False
        if any(token in argv for token in self.REDIRECT_TOKENS):
            return False
        if any(token in lowered for token in self.BLOCKED_TOKENS):
            return False
        return any(lowered == prefix or lowered.startswith(prefix + " ") for prefix in self.ALLOWED_PREFIXES)

    def _is_execution_allowed(self, command: str) -> bool:
        normalized = " ".join((command or "").strip().split())
        lowered = normalized.lower()
        if not self._is_allowed(normalized):
            return False
        blocked_phrases = (
            "npm install",
            "npm ci",
            "pip install",
            "python -m pip",
            "yarn",
            "pnpm",
            "git clone",
            "git pull",
            "git fetch",
        )
        if any(phrase in lowered for phrase in blocked_phrases):
            return False
        return any(lowered == prefix or lowered.startswith(prefix + " ") for prefix in self.EXECUTION_ALLOWED_PREFIXES)

    def _test_run_enabled(self) -> bool:
        return os.getenv("AGENT_TEST_RUN") == "1" and os.getenv("AGENT_TEST_CONFIRM") == "YES"

    def _timeout_seconds(self) -> float:
        raw_timeout = os.getenv("AGENT_TEST_TIMEOUT", "30")
        try:
            timeout = float(raw_timeout)
        except (TypeError, ValueError):
            return 30.0
        return timeout if timeout > 0 else 30.0

    def _working_directory(self) -> Path:
        root = Path(self.working_directory).expanduser().resolve()
        if not root.exists() or not root.is_dir():
            raise ValueError(f"working_directory does not exist or is not a directory: {self.working_directory}")
        return root

    def _argv(self, command: str) -> list[str]:
        argv = shlex.split(command)
        if argv and argv[0].lower() == "python":
            argv[0] = sys.executable
        if argv:
            argv[0] = self._normalize_executable(argv[0])
        return argv

    def _normalize_executable(self, executable: str) -> str:
        if os.name != "nt":
            return executable
        lowered = executable.lower()
        windows_names = {
            "npm": ("npm.cmd",),
            "npx": ("npx.cmd",),
            "node": ("node.exe", "node"),
        }.get(lowered)
        if not windows_names:
            return executable
        for candidate in windows_names:
            resolved = shutil.which(candidate)
            if resolved:
                return resolved
        return executable

    def _execute_command(self, command: str, cwd: Path) -> dict:
        timeout = self._timeout_seconds()
        try:
            completed = subprocess.run(
                self._argv(command),
                cwd=str(cwd),
                timeout=timeout,
                capture_output=True,
                text=True,
                shell=False,
            )
        except subprocess.TimeoutExpired as exc:
            return {
                "command": command,
                "status": "timeout",
                "executed": True,
                "timed_out": True,
                "timeout": timeout,
                "exit_code": None,
                "stdout": exc.stdout or "",
                "stderr": exc.stderr or "",
            }
        except (OSError, ValueError) as exc:
            return {
                "command": command,
                "status": "error",
                "executed": False,
                "timed_out": False,
                "timeout": timeout,
                "exit_code": None,
                "stdout": "",
                "stderr": str(exc),
            }

        return {
            "command": command,
            "status": "passed" if completed.returncode == 0 else "failed",
            "executed": True,
            "timed_out": False,
            "timeout": timeout,
            "exit_code": completed.returncode,
            "stdout": completed.stdout,
            "stderr": completed.stderr,
        }

    def run_tests(self, commands: list[str]) -> dict:
        command_list = list(commands or [])
        allowed = [command for command in command_list if self._is_allowed(command)]
        rejected = [command for command in command_list if command not in allowed]
        verify_preview = {
            "commands": allowed,
            "working_directory": self.working_directory,
            "reason": self.reason,
        }
        if not allowed:
            return {
                "ok": True,
                "passed": None,
                "executed": False,
                "mode": "verify_preview_skipped",
                "verify_preview": verify_preview,
                "verification_required": False,
                "rejected_commands": rejected,
                "reason": "skipped_no_safe_commands",
            }

        if not self._test_run_enabled():
            missing = []
            if os.getenv("AGENT_TEST_RUN") != "1":
                missing.append("AGENT_TEST_RUN=1")
            if os.getenv("AGENT_TEST_CONFIRM") != "YES":
                missing.append("AGENT_TEST_CONFIRM=YES")
            return {
                "ok": True,
                "passed": None,
                "executed": False,
                "mode": "verify_preview_ready" if os.getenv("AGENT_VERIFY") == "1" else "verify_preview_only",
                "verify_preview": verify_preview,
                "verification_required": True,
                "rejected_commands": rejected,
                "execution_required": True,
                "missing_execution_gates": missing,
            }

        executable = [command for command in allowed if self._is_execution_allowed(command)]
        rejected_for_execution = [command for command in allowed if command not in executable]
        rejected_all = rejected + rejected_for_execution
        if not executable:
            return {
                "ok": True,
                "passed": None,
                "executed": False,
                "mode": "test_execution_rejected",
                "verify_preview": verify_preview,
                "verification_required": False,
                "rejected_commands": rejected_all,
                "reason": "no_executable_whitelisted_commands",
            }

        try:
            cwd = self._working_directory()
        except ValueError as exc:
            return {
                "ok": True,
                "passed": False,
                "executed": False,
                "mode": "test_execution_setup_failed",
                "verify_preview": verify_preview,
                "verification_required": False,
                "rejected_commands": rejected_all,
                "reason": str(exc),
            }

        command_results = [self._execute_command(command, cwd) for command in executable]
        passed = all(item.get("exit_code") == 0 for item in command_results)
        return {
            "ok": True,
            "passed": passed,
            "executed": True,
            "mode": "test_execution",
            "verify_preview": verify_preview,
            "verification_required": False,
            "rejected_commands": rejected_all,
            "commands": command_results,
            "working_directory": str(cwd),
        }

        return {
            "ok": True,
            "passed": None,
            "executed": False,
            "mode": "verify_preview_ready" if os.getenv("AGENT_VERIFY") == "1" else "verify_preview_only",
            "verify_preview": verify_preview,
            "verification_required": True,
            "rejected_commands": rejected,
        }


_DEFAULT_TEST_ADAPTER = None


def get_default_test_adapter() -> BaseTestAdapter:
    global _DEFAULT_TEST_ADAPTER
    if _DEFAULT_TEST_ADAPTER is None:
        if os.getenv("AGENT_REPO_MODE", "mock").lower() == "real":
            repo_root = os.getenv("AGENT_REPO_ROOT")
            if not repo_root:
                raise ValueError("AGENT_REPO_ROOT is required when AGENT_REPO_MODE=real")
            _DEFAULT_TEST_ADAPTER = RealTestAdapter(
                working_directory=repo_root,
                reason="python project detected",
            )
        else:
            _DEFAULT_TEST_ADAPTER = MockTestAdapter()
    return _DEFAULT_TEST_ADAPTER
