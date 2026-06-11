import os
from pathlib import Path, PureWindowsPath
from typing import Any, Dict, List

from agent_core.patches.code_patch import unified_diff


class BaseRepoAdapter:
    def list_files(self, path: str = "") -> dict:
        raise NotImplementedError

    def read_file(self, path: str) -> dict:
        raise NotImplementedError

    def apply_patch(self, file: str, changes: list) -> dict:
        raise NotImplementedError

    def apply_code_patch(self, code_patch: dict) -> dict:
        raise NotImplementedError

    def get_diff(self) -> dict:
        raise NotImplementedError

    def run_command(self, command: str) -> dict:
        raise NotImplementedError


class MockRepoAdapter(BaseRepoAdapter):
    is_real_repo = False

    def __init__(self):
        self.files = {}
        self.applied_patches = []

    def read_file(self, path: str) -> dict:
        return {
            "ok": True,
            "path": path,
            "content": self.files.get(path, ""),
        }

    def list_files(self, path: str = "") -> dict:
        files = sorted(name for name in self.files if not path or name.startswith(path))
        return {
            "ok": True,
            "files": files,
            "mode": "mock_repo",
        }

    def apply_patch(self, file: str, changes: list = None) -> dict:
        if isinstance(file, dict):
            patch = dict(file)
            target_file = patch.get("path") or patch.get("file", "")
            patch_changes = patch.get("changes", changes or [])
        else:
            patch = {"file": file, "changes": list(changes or [])}
            target_file = file
            patch_changes = changes or []

        record = {"file": target_file, "changes": list(patch_changes or []), "patch": patch}
        self.applied_patches.append(record)
        return {
            "ok": True,
            "file": target_file,
            "applied": True,
            "mode": "mock_repo",
        }

    def apply_code_patch(self, code_patch: dict) -> dict:
        patch = dict(code_patch or {})
        target_file = patch.get("file") or patch.get("path", "")
        record = {"file": target_file, "patch": patch, "diff": patch.get("diff", "")}
        self.applied_patches.append(record)
        return {
            "ok": True,
            "operation": patch.get("operation") or "replace",
            "file": target_file,
            "path": target_file,
            "applied": True,
            "dry_run": False,
            "preview": False,
            "real_write": False,
            "mode": "mock_repo",
            "diff": patch.get("diff", ""),
            "dry_run_diff": patch.get("diff", ""),
            "preview_diff": patch.get("diff", ""),
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
    is_real_repo = True

    IGNORED_DIRS = {".git", "__pycache__", "node_modules", ".venv", "venv", "dist", "build", ".idea", ".vscode"}
    CODE_EXTENSIONS = {".py", ".js", ".jsx", ".ts", ".tsx", ".json", ".md"}

    def __init__(self, repo_root: str):
        if not repo_root:
            raise ValueError("repo_root is required for RealRepoAdapter")

        root = Path(repo_root).expanduser().resolve()
        if not root.exists() or not root.is_dir():
            raise ValueError(f"repo_root does not exist or is not a directory: {repo_root}")

        self.repo_root = root
        self.dry_run_patches = []

    def _resolve_repo_path(self, path: str) -> Path:
        if not path:
            raise ValueError("path is required")

        normalized = path.replace("\\", "/")
        if Path(path).is_absolute() or PureWindowsPath(path).drive or normalized.startswith("/"):
            raise ValueError(f"absolute paths are not allowed: {path}")

        if ".." in [part for part in normalized.split("/") if part]:
            raise ValueError(f"path escape is not allowed: {path}")

        resolved = (self.repo_root / path).resolve()
        try:
            resolved.relative_to(self.repo_root)
        except ValueError:
            raise ValueError(f"path points outside repo_root: {path}")

        return resolved

    def read_file(self, path: str) -> dict:
        try:
            resolved = self._resolve_repo_path(path)
            content = resolved.read_text(encoding="utf-8")
        except (OSError, UnicodeError, ValueError) as exc:
            return {
                "ok": False,
                "path": path,
                "error": str(exc),
                "mode": "real_repo_readonly",
            }

        return {
            "ok": True,
            "path": path,
            "resolved_path": str(resolved),
            "content": content,
            "mode": "real_repo_readonly",
        }

    def list_files(self, path: str = "") -> dict:
        try:
            base = self._resolve_repo_path(path) if path else self.repo_root
        except ValueError as exc:
            return {
                "ok": False,
                "path": path,
                "files": [],
                "error": str(exc),
                "mode": "real_repo_readonly",
            }

        if not base.exists():
            return {
                "ok": False,
                "path": path,
                "files": [],
                "error": f"path does not exist: {path}",
                "mode": "real_repo_readonly",
            }

        roots = [base] if base.is_file() else base.rglob("*")
        files = []
        for candidate in roots:
            if not candidate.is_file():
                continue

            relative = candidate.relative_to(self.repo_root)
            if any(part in self.IGNORED_DIRS for part in relative.parts):
                continue
            if candidate.suffix.lower() not in self.CODE_EXTENSIONS:
                continue

            files.append(
                {
                    "path": relative.as_posix(),
                    "resolved_path": str(candidate),
                }
            )

        files.sort(key=lambda item: item["path"])
        return {
            "ok": True,
            "path": path,
            "files": files,
            "mode": "real_repo_readonly",
        }

    def _content_preview(self, content: str) -> str:
        preview = str(content or "")
        return preview[:120]

    def _code_patch_diff(self, path: str, before: str, after: str, fallback: str = "") -> str:
        diff = unified_diff(path, before, after)
        return diff or str(fallback or "")

    def _apply_enabled(self) -> bool:
        return os.getenv("AGENT_REPO_APPLY") == "1"

    def _confirmed(self) -> bool:
        return os.getenv("AGENT_REPO_CONFIRM") == "YES"

    def _diff_preview(self, operation: str, path: str, resolved: Path, content: str) -> str:
        preview = self._content_preview(content)
        if operation == "create_file":
            return f"--- /dev/null\n+++ {path}\n+{preview}"
        if operation == "replace_file":
            old_preview = ""
            if resolved.exists():
                try:
                    old_preview = self._content_preview(resolved.read_text(encoding="utf-8"))
                except (OSError, UnicodeError):
                    old_preview = "<unable to read existing content>"
            return f"--- {path}\n- {old_preview}\n+++ {path}\n+ {preview}"
        if operation == "append_text":
            return f"--- {path}\n+++ {path}\n+{preview}"
        return f"{operation} {path}"

    def _preview_operation(self, operation: str, path: str, content: str) -> dict:
        try:
            resolved = self._resolve_repo_path(path)
        except ValueError as exc:
            return {
                "ok": False,
                "operation": operation,
                "path": path,
                "file": path,
                "applied": False,
                "real_write": False,
                "dry_run": False,
                "preview": False,
                "approval_required": True,
                "mode": "real_repo_preview",
                "would_write": False,
                "error": str(exc),
            }

        before_exists = resolved.exists()
        result = {
            "ok": True,
            "operation": operation,
            "path": path,
            "file": path,
            "resolved_path": str(resolved),
            "applied": False,
            "real_write": False,
            "dry_run": False,
            "preview": True,
            "approval_required": True,
            "mode": "real_repo_preview",
            "would_write": True,
            "content_preview": self._content_preview(content),
            "diff_preview": self._diff_preview(operation, path, resolved, content),
            "before_exists": before_exists,
            "after_exists": before_exists,
            "bytes_written": 0,
        }
        self.dry_run_patches.append(result)
        return result

    def _operation_result(
        self,
        operation: str,
        path: str,
        resolved: Path,
        content: str,
        before_exists: bool,
        after_exists: bool,
        bytes_written: int,
        applied: bool,
        dry_run: bool,
        error: str = None,
    ) -> dict:
        result = {
            "ok": error is None,
            "operation": operation,
            "path": path,
            "file": path,
            "resolved_path": str(resolved),
            "applied": applied,
            "real_write": applied,
            "dry_run": dry_run,
            "preview": False,
            "approval_required": False,
            "mode": "real_repo_apply" if applied else "real_repo_dry_run",
            "would_write": True,
            "content_preview": self._content_preview(content),
            "diff_preview": self._diff_preview(operation, path, resolved, content),
            "before_exists": before_exists,
            "after_exists": after_exists,
            "bytes_written": bytes_written,
        }
        if error:
            result["error"] = error
        return result

    def _dry_run_operation(self, operation: str, path: str, content: str) -> dict:
        try:
            resolved = self._resolve_repo_path(path)
        except ValueError as exc:
            return {
                "ok": False,
                "file": path,
                "path": path,
                "applied": False,
                "dry_run": True,
                "mode": "real_repo_dry_run",
                "error": str(exc),
            }

        before_exists = resolved.exists()
        record = {
            "operation": operation,
            "path": path,
            "file": path,
            "resolved_path": str(resolved),
            "would_write": True,
            "content_preview": self._content_preview(content),
            "before_exists": before_exists,
            "after_exists": before_exists,
            "bytes_written": 0,
        }
        self.dry_run_patches.append(record)
        return {
            "ok": True,
            "operation": operation,
            "path": path,
            "file": path,
            "resolved_path": str(resolved),
            "applied": False,
            "dry_run": True,
            "preview": False,
            "approval_required": False,
            "mode": "real_repo_dry_run",
            "would_write": True,
            "content_preview": self._content_preview(content),
            "diff_preview": self._diff_preview(operation, path, resolved, content),
            "before_exists": before_exists,
            "after_exists": before_exists,
            "bytes_written": 0,
            "summary": f"{operation} recorded as dry-run; no files were modified.",
        }

    def _apply_operation(self, operation: str, path: str, content: str, overwrite: bool = False) -> dict:
        try:
            resolved = self._resolve_repo_path(path)
        except ValueError as exc:
            return {
                "ok": False,
                "operation": operation,
                "path": path,
                "file": path,
                "applied": False,
                "real_write": False,
                "dry_run": False,
                "preview": False,
                "approval_required": False,
                "mode": "real_repo_apply",
                "would_write": False,
                "error": str(exc),
            }

        content_text = str(content or "")
        if operation in {"create_file", "replace_file", "append_text"} and not content_text.strip():
            return {
                "ok": False,
                "operation": operation,
                "path": path,
                "file": path,
                "resolved_path": str(resolved),
                "applied": False,
                "real_write": False,
                "dry_run": False,
                "preview": False,
                "approval_required": False,
                "mode": "real_repo_apply",
                "would_write": False,
                "content_preview": "",
                "before_exists": resolved.exists(),
                "after_exists": resolved.exists(),
                "bytes_written": 0,
                "error": f"{operation} requires non-empty content",
            }

        before_exists = resolved.exists()
        error = None
        if operation == "create_file" and before_exists and not overwrite:
            error = "create_file target already exists"
        elif operation in {"replace_file", "append_text"} and not before_exists:
            error = f"{operation} target does not exist"

        if error:
            result = self._operation_result(
                operation=operation,
                path=path,
                resolved=resolved,
                content=content,
                before_exists=before_exists,
                after_exists=before_exists,
                bytes_written=0,
                applied=False,
                dry_run=False,
                error=error,
            )
            result["mode"] = "real_repo_apply"
            self.dry_run_patches.append(result)
            return result

        resolved.parent.mkdir(parents=True, exist_ok=True)
        if operation in {"create_file", "replace_file"}:
            resolved.write_text(content_text, encoding="utf-8")
        elif operation == "append_text":
            with resolved.open("a", encoding="utf-8") as handle:
                handle.write(content_text)

        bytes_written = len(content_text.encode("utf-8"))
        result = self._operation_result(
            operation=operation,
            path=path,
            resolved=resolved,
            content=content,
            before_exists=before_exists,
            after_exists=resolved.exists(),
            bytes_written=bytes_written,
            applied=True,
            dry_run=False,
        )
        result["summary"] = f"{operation} applied to real repository."
        self.dry_run_patches.append(result)
        return result

    def apply_patch(self, file: str, changes: list = None) -> dict:
        patch = file if isinstance(file, dict) else None
        if patch is not None and patch.get("operation"):
            operation = patch.get("operation")
            path = patch.get("path") or patch.get("file", "")
            content = patch.get("content", "")
            overwrite = patch.get("overwrite") is True
            if operation not in {"create_file", "replace_file", "append_text"}:
                return {
                    "ok": False,
                    "operation": operation,
                    "path": path,
                    "file": path,
                    "applied": False,
                    "dry_run": True,
                    "mode": "real_repo_dry_run",
                    "would_write": False,
                    "error": f"Unsupported patch operation: {operation}",
                }
            if self._apply_enabled():
                if not self._confirmed():
                    return self._preview_operation(operation, path, content)
                return self._apply_operation(operation, path, content, overwrite=overwrite)
            return self._dry_run_operation(operation, path, content)

        target_file = patch.get("path") or patch.get("file", "") if isinstance(patch, dict) else file
        text_changes = patch.get("changes", changes or []) if isinstance(patch, dict) else changes or []
        try:
            resolved = self._resolve_repo_path(target_file)
        except ValueError as exc:
            return {
                "ok": False,
                "file": target_file,
                "path": target_file,
                "applied": False,
                "dry_run": True,
                "mode": "real_repo_dry_run",
                "error": str(exc),
            }

        record = {
            "operation": "dry_run_text_change",
            "file": target_file,
            "path": target_file,
            "resolved_path": str(resolved),
            "changes": list(text_changes or []),
            "would_write": False,
            "unsupported_for_real_write": True,
            "content_preview": self._content_preview("\n".join(str(item) for item in text_changes or [])),
            "before_exists": resolved.exists(),
            "after_exists": resolved.exists(),
            "bytes_written": 0,
        }
        self.dry_run_patches.append(record)
        return {
            "ok": True,
            "operation": "dry_run_text_change",
            "file": target_file,
            "path": target_file,
            "resolved_path": str(resolved),
            "applied": False,
            "dry_run": True,
            "mode": "real_repo_dry_run",
            "would_write": False,
            "unsupported_for_real_write": True,
            "content_preview": record["content_preview"],
            "before_exists": record["before_exists"],
            "after_exists": record["after_exists"],
            "bytes_written": 0,
            "summary": "Natural language changes recorded as dry-run; unsupported for real write.",
        }

    def _code_patch_result(
        self,
        patch: dict,
        resolved: Path,
        before: str,
        after: str,
        applied: bool,
        dry_run: bool,
        preview: bool,
        mode: str,
        error: str = None,
    ) -> dict:
        path = patch.get("file") or patch.get("path", "")
        diff = self._code_patch_diff(path, before, after, fallback=patch.get("diff"))
        result = {
            "ok": error is None,
            "operation": patch.get("operation") or "replace",
            "path": path,
            "file": path,
            "resolved_path": str(resolved),
            "applied": applied,
            "real_write": applied,
            "dry_run": dry_run,
            "preview": preview,
            "approval_required": preview,
            "mode": mode,
            "would_write": True,
            "content_preview": self._content_preview(after),
            "before_exists": resolved.exists(),
            "after_exists": resolved.exists() if not applied else True,
            "bytes_written": len(after.encode("utf-8")) if applied else 0,
            "diff": diff,
            "dry_run_diff": diff if dry_run else None,
            "preview_diff": diff if preview else None,
            "diff_preview": diff,
            "confidence": patch.get("confidence"),
        }
        if error:
            result["error"] = error
        return result

    def apply_code_patch(self, code_patch: dict) -> dict:
        patch = dict(code_patch or {})
        path = patch.get("file") or patch.get("path", "")
        try:
            resolved = self._resolve_repo_path(path)
        except ValueError as exc:
            return {
                "ok": False,
                "operation": patch.get("operation") or "replace",
                "path": path,
                "file": path,
                "applied": False,
                "dry_run": True,
                "mode": "real_repo_dry_run",
                "would_write": False,
                "error": str(exc),
            }

        before = patch.get("before_snippet")
        if before is None:
            before = resolved.read_text(encoding="utf-8") if resolved.exists() else ""
        after = patch.get("after_snippet")
        if after is None:
            return self._code_patch_result(
                patch,
                resolved,
                str(before or ""),
                str(before or ""),
                applied=False,
                dry_run=True,
                preview=False,
                mode="real_repo_dry_run",
                error="after_snippet is required",
            )

        before = str(before or "")
        after = str(after or "")
        if self._apply_enabled():
            if not self._confirmed():
                result = self._code_patch_result(
                    patch,
                    resolved,
                    before,
                    after,
                    applied=False,
                    dry_run=False,
                    preview=True,
                    mode="real_repo_preview",
                )
                self.dry_run_patches.append(result)
                return result
            resolved.parent.mkdir(parents=True, exist_ok=True)
            resolved.write_text(after, encoding="utf-8")
            result = self._code_patch_result(
                patch,
                resolved,
                before,
                after,
                applied=True,
                dry_run=False,
                preview=False,
                mode="real_repo_apply",
            )
            self.dry_run_patches.append(result)
            return result

        result = self._code_patch_result(
            patch,
            resolved,
            before,
            after,
            applied=False,
            dry_run=True,
            preview=False,
            mode="real_repo_dry_run",
        )
        self.dry_run_patches.append(result)
        return result

    def get_diff(self) -> dict:
        return {
            "ok": True,
            "mode": "real_repo_dry_run",
            "diff": list(self.dry_run_patches),
        }

    def run_command(self, command: str) -> dict:
        return {
            "ok": False,
            "command": command,
            "mode": "real_repo_readonly",
            "exit_code": None,
            "error": "RealRepoAdapter does not execute commands in dry-run mode.",
        }


_DEFAULT_REPO_ADAPTER = None


def get_default_repo_adapter() -> BaseRepoAdapter:
    global _DEFAULT_REPO_ADAPTER
    if _DEFAULT_REPO_ADAPTER is None:
        mode = os.getenv("AGENT_REPO_MODE", "mock").lower()
        if mode == "real":
            repo_root = os.getenv("AGENT_REPO_ROOT")
            if not repo_root:
                raise ValueError("AGENT_REPO_ROOT is required when AGENT_REPO_MODE=real")
            _DEFAULT_REPO_ADAPTER = RealRepoAdapter(repo_root)
        else:
            _DEFAULT_REPO_ADAPTER = MockRepoAdapter()
    return _DEFAULT_REPO_ADAPTER
