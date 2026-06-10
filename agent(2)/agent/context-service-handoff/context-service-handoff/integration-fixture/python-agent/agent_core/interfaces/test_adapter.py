from __future__ import annotations

import os
import subprocess
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
    ALLOWED_COMMANDS = {
        "npm test",
        "npm run lint",
        "pytest -q",
    }

    def __init__(self, repo_root: str, dry_run: bool = True, timeout_seconds: int = 60):
        if not repo_root:
            raise ValueError("repo_root is required")
        self.repo_root = Path(repo_root).resolve()
        self.dry_run = dry_run
        self.timeout_seconds = timeout_seconds
        if not self.repo_root.exists() or not self.repo_root.is_dir():
            raise ValueError(f"repo_root does not exist or is not a directory: {repo_root}")

    def run_tests(self, commands: list[str]) -> dict:
        command_results = [self._run_command(command) for command in commands]
        return {
            "ok": all(result["exit_code"] == 0 for result in command_results),
            "passed": all(result["exit_code"] == 0 for result in command_results),
            "mode": "real_test_dry_run" if self.dry_run else "real_test",
            "commands": command_results,
        }

    def _run_command(self, command: str) -> dict:
        if command not in self.ALLOWED_COMMANDS:
            return {
                "command": command,
                "status": "blocked",
                "exit_code": 126,
                "output": "Command is not allowed by RealTestAdapter.",
            }
        if self.dry_run:
            return {
                "command": command,
                "status": "dry_run",
                "exit_code": 0,
                "output": "Dry-run command accepted; not executed.",
            }
        result = subprocess.run(
            command.split(),
            cwd=str(self.repo_root),
            capture_output=True,
            text=True,
            timeout=self.timeout_seconds,
            check=False,
        )
        output = "\n".join(part for part in [result.stdout, result.stderr] if part)
        return {
            "command": command,
            "status": "passed" if result.returncode == 0 else "failed",
            "exit_code": result.returncode,
            "output": output[-4000:],
        }


_DEFAULT_TEST_ADAPTER = None


def get_default_test_adapter() -> BaseTestAdapter:
    global _DEFAULT_TEST_ADAPTER
    if _DEFAULT_TEST_ADAPTER is None:
        if os.getenv("USE_REAL_TEST") == "1":
            _DEFAULT_TEST_ADAPTER = RealTestAdapter(
                repo_root=os.getenv("AGENT_REPO_ROOT", ""),
                dry_run=os.getenv("REAL_TEST_DRY_RUN", "1") != "0",
            )
        else:
            _DEFAULT_TEST_ADAPTER = MockTestAdapter()
    return _DEFAULT_TEST_ADAPTER
