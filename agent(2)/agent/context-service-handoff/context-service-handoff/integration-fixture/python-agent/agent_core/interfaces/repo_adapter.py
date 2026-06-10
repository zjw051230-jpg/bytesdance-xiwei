import os
import subprocess
from pathlib import Path
from typing import Any, Dict, List


class BaseRepoAdapter:
    def read_file(self, path: str) -> dict:
        raise NotImplementedError

    def apply_patch(self, file: str, changes: list) -> dict:
        raise NotImplementedError

    def get_diff(self) -> dict:
        raise NotImplementedError

    def run_command(self, command: str) -> dict:
        raise NotImplementedError


class MockRepoAdapter(BaseRepoAdapter):
    def __init__(self):
        self.files = {}
        self.applied_patches = []

    def read_file(self, path: str) -> dict:
        return {
            "ok": True,
            "path": path,
            "content": self.files.get(path, ""),
        }

    def apply_patch(self, file: str, changes: list) -> dict:
        record = {"file": file, "changes": list(changes)}
        self.applied_patches.append(record)
        return {
            "ok": True,
            "file": file,
            "applied": True,
            "mode": "mock",
        }

    def get_diff(self) -> dict:
        return {
            "ok": True,
            "diff": list(self.applied_patches),
        }

    def run_command(self, command: str) -> dict:
        return {
            "ok": True,
            "command": command,
            "output": "Mock command executed",
            "exit_code": 0,
        }


class RealRepoAdapter(BaseRepoAdapter):
    FORBIDDEN_PATH_PARTS = {".git", "node_modules", "__pycache__"}
    FORBIDDEN_FILE_NAMES = {".env", "package-lock.json", "yarn.lock", "pnpm-lock.yaml"}

    def __init__(self, repo_root: str, dry_run: bool = True, timeout_seconds: int = 30):
        if not repo_root:
            raise ValueError("repo_root is required")
        self.repo_root = Path(repo_root).resolve()
        self.dry_run = dry_run
        self.timeout_seconds = timeout_seconds
        self.planned_patches: List[Dict[str, Any]] = []
        if not self.repo_root.exists() or not self.repo_root.is_dir():
            raise ValueError(f"repo_root does not exist or is not a directory: {repo_root}")

    def read_file(self, path: str) -> dict:
        file_path = self._resolve_repo_path(path)
        if not file_path.exists() or not file_path.is_file():
            return {
                "ok": False,
                "path": path,
                "error": "file not found",
            }
        return {
            "ok": True,
            "path": path,
            "content": file_path.read_text(encoding="utf-8"),
        }

    def apply_patch(self, file: str, changes: list) -> dict:
        file_path = self._resolve_repo_path(file)
        record = {
            "file": file,
            "changes": list(changes or []),
            "dry_run": self.dry_run,
            "exists": file_path.exists(),
        }
        self.planned_patches.append(record)
        return {
            "ok": True,
            "file": file,
            "applied": False if self.dry_run else True,
            "mode": "real_repo_dry_run" if self.dry_run else "real_repo",
            "dry_run": self.dry_run,
            "planned_changes": list(changes or []),
            "target_exists": file_path.exists(),
        }

    def get_diff(self) -> dict:
        if self.dry_run:
            return {
                "ok": True,
                "mode": "real_repo_dry_run",
                "diff": list(self.planned_patches),
            }
        result = self._run(["git", "diff", "--"], timeout_seconds=self.timeout_seconds)
        return {
            "ok": result["exit_code"] == 0,
            "mode": "real_repo",
            "diff": result["output"],
            "exit_code": result["exit_code"],
        }

    def run_command(self, command: str) -> dict:
        if not self._is_allowed_command(command):
            return {
                "ok": False,
                "command": command,
                "output": "Command is not allowed by RealRepoAdapter.",
                "exit_code": 126,
            }
        if self.dry_run:
            return {
                "ok": True,
                "command": command,
                "output": "Dry-run command accepted; not executed.",
                "exit_code": 0,
                "mode": "real_repo_dry_run",
            }
        return self._run(command.split(), timeout_seconds=self.timeout_seconds)

    def _resolve_repo_path(self, relative_path: str) -> Path:
        if not relative_path or Path(relative_path).is_absolute():
            raise ValueError("repo path must be a relative path")
        path_parts = set(Path(relative_path).parts)
        if path_parts & self.FORBIDDEN_PATH_PARTS:
            raise ValueError(f"repo path contains forbidden segment: {relative_path}")
        if Path(relative_path).name in self.FORBIDDEN_FILE_NAMES:
            raise ValueError(f"repo path targets forbidden file: {relative_path}")
        resolved = (self.repo_root / relative_path).resolve()
        if self.repo_root not in resolved.parents and resolved != self.repo_root:
            raise ValueError("repo path escapes repo_root")
        return resolved

    def _is_allowed_command(self, command: str) -> bool:
        allowed_commands = {
            "npm test",
            "npm run lint",
            "pytest -q",
        }
        return command in allowed_commands

    def _run(self, args: list, timeout_seconds: int) -> dict:
        result = subprocess.run(
            args,
            cwd=str(self.repo_root),
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
            check=False,
        )
        output = "\n".join(part for part in [result.stdout, result.stderr] if part)
        return {
            "ok": result.returncode == 0,
            "command": " ".join(args),
            "output": output[-4000:],
            "exit_code": result.returncode,
        }


_DEFAULT_REPO_ADAPTER = None


def get_default_repo_adapter() -> BaseRepoAdapter:
    global _DEFAULT_REPO_ADAPTER
    if _DEFAULT_REPO_ADAPTER is None:
        if os.getenv("USE_REAL_REPO") == "1":
            _DEFAULT_REPO_ADAPTER = RealRepoAdapter(
                repo_root=os.getenv("AGENT_REPO_ROOT", ""),
                dry_run=os.getenv("REAL_REPO_DRY_RUN", "1") != "0",
            )
        else:
            _DEFAULT_REPO_ADAPTER = MockRepoAdapter()
    return _DEFAULT_REPO_ADAPTER
