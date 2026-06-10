from dataclasses import dataclass
import difflib
from typing import Any, Dict, Optional


@dataclass
class CodePatch:
    file: str
    operation: str
    before_snippet: str
    after_snippet: str
    diff: str
    confidence: float

    def to_dict(self) -> Dict[str, Any]:
        return {
            "file": self.file,
            "operation": self.operation,
            "before_snippet": self.before_snippet,
            "after_snippet": self.after_snippet,
            "diff": self.diff,
            "confidence": self.confidence,
        }


def unified_diff(file_path: str, before: str, after: str) -> str:
    before_lines = str(before or "").splitlines(keepends=True)
    after_lines = str(after or "").splitlines(keepends=True)
    return "".join(
        difflib.unified_diff(
            before_lines,
            after_lines,
            fromfile=f"a/{file_path}",
            tofile=f"b/{file_path}",
            lineterm="",
        )
    )


def build_code_patch(
    file_path: str,
    before: str,
    after: str,
    operation: str = "replace",
    confidence: float = 0.72,
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    patch = CodePatch(
        file=file_path,
        operation=operation,
        before_snippet=str(before or ""),
        after_snippet=str(after or ""),
        diff=unified_diff(file_path, before, after),
        confidence=float(confidence),
    ).to_dict()
    if extra:
        patch.update(extra)
    return patch
