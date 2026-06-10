import ast
import re
from typing import Any, Dict, List, Optional, Tuple


JS_EXTENSIONS = (".js", ".jsx", ".ts", ".tsx")
PY_EXTENSIONS = (".py",)
HOOK_CALL_RE = re.compile(r"\b(use[A-Z][A-Za-z0-9_]*)\s*\(")
CONTROL_RE = re.compile(r"^\s*(if|for|while|switch|try|catch|else|elif|with)\b")
FUNCTION_DECL_RE = re.compile(r"\bfunction\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(")
ARROW_ASSIGN_RE = re.compile(
    r"\b(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][A-Za-z0-9_$]*)\s*=>"
)


def validate_patch(patch_plan, repo_profile=None) -> Dict[str, Any]:
    errors: List[Dict[str, Any]] = []
    warnings: List[Dict[str, Any]] = []
    patch_plan = patch_plan or {}

    patches = _patches_to_validate(patch_plan)
    if not isinstance(patch_plan, dict) or not patches:
        errors.append(_issue("", "missing_patch_plan", "Patch plan must contain at least one patch"))
        return _result(errors, warnings)

    for index, patch in enumerate(patches):
        if not isinstance(patch, dict):
            errors.append(_issue("", "patch_not_object", f"Patch #{index} is not an object"))
            continue

        file_path = str(patch.get("file") or patch.get("path") or "")
        if _is_code_patch(patch):
            _validate_code_patch_shape(index, file_path, patch, errors)
            after = str(patch.get("after_snippet") or "")
            if _contains_todo_patch(after) or _contains_todo_patch(str(patch.get("diff") or "")):
                errors.append(_issue(file_path or f"patch#{index}", "todo_code_patch", "CodePatch must contain executable code, not TODO placeholders"))
            if after.strip():
                _validate_code_syntax(file_path, after, errors, warnings)

    return _result(errors, warnings)


def _patches_to_validate(patch_plan: Dict[str, Any]) -> List[Dict[str, Any]]:
    if not isinstance(patch_plan, dict):
        return []
    code_patches = patch_plan.get("code_patches")
    if isinstance(code_patches, list) and code_patches:
        return code_patches
    patches = patch_plan.get("patches")
    return patches if isinstance(patches, list) else []


def _result(errors: List[Dict[str, Any]], warnings: List[Dict[str, Any]]) -> Dict[str, Any]:
    approved = not errors
    return {
        "approved": approved,
        "syntax_valid": approved,
        "errors": errors,
        "warnings": warnings,
    }


def _issue(file_path: str, code: str, message: str) -> Dict[str, Any]:
    return {
        "file": file_path,
        "code": code,
        "message": message,
    }


def _is_code_patch(patch: Dict[str, Any]) -> bool:
    return any(key in patch for key in ("diff", "before_snippet", "after_snippet")) or patch.get("operation") == "replace"


def _validate_code_patch_shape(index: int, file_path: str, patch: Dict[str, Any], errors: List[Dict[str, Any]]) -> None:
    label = file_path or f"patch#{index}"
    if not str(patch.get("after_snippet") or "").strip():
        errors.append(_issue(label, "empty_after_snippet", "CodePatch after_snippet must not be empty"))
    if not str(patch.get("diff") or "").strip():
        errors.append(_issue(label, "empty_diff", "CodePatch diff must not be empty"))
    if patch.get("operation") == "replace":
        if "before_snippet" not in patch:
            errors.append(_issue(label, "missing_before_snippet", "replace CodePatch must include before_snippet"))
        if "after_snippet" not in patch or not str(patch.get("after_snippet") or "").strip():
            errors.append(_issue(label, "missing_after_snippet", "replace CodePatch must include after_snippet"))


def _contains_todo_patch(text: str) -> bool:
    return bool(re.search(r"\bTODO\b|todo:\s*|implement requested change", str(text or ""), flags=re.IGNORECASE))


def _validate_code_syntax(file_path: str, source: str, errors: List[Dict[str, Any]], warnings: List[Dict[str, Any]]) -> None:
    lowered = file_path.lower()
    if lowered.endswith(PY_EXTENSIONS):
        try:
            ast.parse(source)
        except SyntaxError as exc:
            errors.append(_issue(file_path, "python_syntax_error", f"Python syntax error: {exc.msg} at line {exc.lineno}"))
        return

    if lowered.endswith(JS_EXTENSIONS):
        js_errors, js_warnings = _validate_js_lightweight(source)
        errors.extend(_issue(file_path, code, message) for code, message in js_errors)
        warnings.extend(_issue(file_path, code, message) for code, message in js_warnings)


def _validate_js_lightweight(source: str) -> Tuple[List[Tuple[str, str]], List[Tuple[str, str]]]:
    errors: List[Tuple[str, str]] = []
    warnings: List[Tuple[str, str]] = []
    stripped_source = _strip_js_comments_and_strings(source)

    balance_error = _check_balanced_brackets(stripped_source)
    if balance_error:
        errors.append(("js_bracket_mismatch", balance_error))

    _check_import_export_positions(stripped_source, errors, warnings)
    _check_invalid_js_patterns(source, stripped_source, errors)
    _check_jsx_position(source, errors)
    _check_hook_positions(stripped_source, errors)
    return errors, warnings


def _check_invalid_js_patterns(source: str, stripped_source: str, errors: List[Tuple[str, str]]) -> None:
    _check_naked_object_property_statement(stripped_source, errors)
    _check_const_inside_use_state(stripped_source, errors)
    _check_invalid_sequelize_string_type(source, errors)


def _check_naked_object_property_statement(source: str, errors: List[Tuple[str, str]]) -> None:
    previous = ""
    for line_no, line in enumerate(source.splitlines(), start=1):
        stripped = line.strip()
        if re.match(r"^[A-Za-z_$][A-Za-z0-9_$]*\s*:\s*[^;]+,?\s*$", stripped):
            if previous.endswith(("};", "});")) or re.match(r"^(?:const|let|var)\s+\w+\s*=.*;\s*$", previous):
                errors.append(("js_naked_object_property", f"Object property appears outside an object literal at line {line_no}"))
        if stripped:
            previous = stripped


def _check_const_inside_use_state(source: str, errors: List[Tuple[str, str]]) -> None:
    for match in re.finditer(r"useState\s*\(", source):
        start = match.end()
        depth = 1
        index = start
        while index < len(source) and depth > 0:
            ch = source[index]
            if ch == "(":
                depth += 1
            elif ch == ")":
                depth -= 1
            index += 1
        args = source[start : index - 1]
        if re.search(r"\bconst\b", args):
            line_no = source.count("\n", 0, match.start()) + 1
            errors.append(("js_const_inside_call_args", f"const declaration appears inside useState arguments at line {line_no}"))


def _check_invalid_sequelize_string_type(source: str, errors: List[Tuple[str, str]]) -> None:
    if "DataTypes" not in source:
        return
    for match in re.finditer(r"\bcoverImage\s*:\s*\{\s*type\s*:\s*String\s*\}", source):
        line_no = source.count("\n", 0, match.start()) + 1
        errors.append(("sequelize_invalid_string_type", f"Use DataTypes.STRING for Sequelize model field at line {line_no}"))


def _strip_js_comments_and_strings(source: str) -> str:
    result = []
    index = 0
    in_string = None
    in_line_comment = False
    in_block_comment = False
    while index < len(source):
        ch = source[index]
        nxt = source[index + 1] if index + 1 < len(source) else ""
        if in_line_comment:
            if ch == "\n":
                in_line_comment = False
                result.append(ch)
            else:
                result.append(" ")
        elif in_block_comment:
            if ch == "*" and nxt == "/":
                in_block_comment = False
                result.extend("  ")
                index += 1
            else:
                result.append("\n" if ch == "\n" else " ")
        elif in_string:
            if ch == "\\":
                result.extend("  ")
                index += 1
            elif ch == in_string:
                in_string = None
                result.append(" ")
            else:
                result.append("\n" if ch == "\n" else " ")
        elif ch == "/" and nxt == "/":
            in_line_comment = True
            result.extend("  ")
            index += 1
        elif ch == "/" and nxt == "*":
            in_block_comment = True
            result.extend("  ")
            index += 1
        elif ch in {"'", '"', "`"}:
            in_string = ch
            result.append(" ")
        else:
            result.append(ch)
        index += 1
    return "".join(result)


def _check_balanced_brackets(source: str) -> Optional[str]:
    pairs = {")": "(", "]": "[", "}": "{"}
    stack: List[Tuple[str, int]] = []
    for line_no, line in enumerate(source.splitlines(), start=1):
        for ch in line:
            if ch in "([{":
                stack.append((ch, line_no))
            elif ch in pairs:
                if not stack or stack[-1][0] != pairs[ch]:
                    return f"Unmatched {ch} at line {line_no}"
                stack.pop()
    if stack:
        ch, line_no = stack[-1]
        return f"Unclosed {ch} from line {line_no}"
    return None


def _check_import_export_positions(source: str, errors: List[Tuple[str, str]], warnings: List[Tuple[str, str]]) -> None:
    depth = 0
    seen_non_import = False
    for line_no, line in enumerate(source.splitlines(), start=1):
        stripped = line.strip()
        starts_module_decl = stripped.startswith("import ") or stripped.startswith("export ")
        if starts_module_decl and depth > 0:
            errors.append(("js_module_decl_not_top_level", f"import/export must be top-level at line {line_no}"))
        if stripped and not stripped.startswith(("import ", "export ")) and not stripped.startswith("//"):
            seen_non_import = True
        if stripped.startswith("import ") and seen_non_import:
            warnings.append(("js_import_after_statement", f"import appears after executable code at line {line_no}"))
        depth += line.count("{") - line.count("}")
        depth = max(depth, 0)


def _check_jsx_position(source: str, errors: List[Tuple[str, str]]) -> None:
    jsx_context: Optional[Dict[str, Any]] = None
    for line_no, line in enumerate(source.splitlines(), start=1):
        stripped = line.strip()
        if not stripped:
            continue

        if jsx_context is None:
            jsx_context = _jsx_context_started_by_line(stripped)

        if _line_starts_jsx_tag(stripped) and jsx_context is None:
            errors.append(("jsx_outside_return", f"JSX appears outside return or assignment at line {line_no}"))

        if jsx_context is not None:
            jsx_context["paren_depth"] += _paren_delta(line)
            if jsx_context["paren_depth"] <= 0 and _line_can_end_jsx_context(stripped):
                jsx_context = None


def _jsx_context_started_by_line(stripped: str) -> Optional[Dict[str, Any]]:
    if _starts_return_expression(stripped):
        return {"kind": "return", "paren_depth": 0}
    if _starts_assignment_expression(stripped):
        return {"kind": "assignment", "paren_depth": 0}
    return None


def _starts_return_expression(stripped: str) -> bool:
    if not re.match(r"^return\b", stripped):
        return False
    if _line_starts_jsx_tag(stripped[len("return") :].lstrip()):
        return False
    return "(" in stripped


def _starts_assignment_expression(stripped: str) -> bool:
    return bool(re.match(r"^(?:const|let|var)\s+[A-Za-z_$][A-Za-z0-9_$]*\s*=\s*\($", stripped))


def _line_starts_jsx_tag(stripped: str) -> bool:
    return bool(re.match(r"^</?[A-Za-z]", stripped))


def _line_can_end_jsx_context(stripped: str) -> bool:
    return stripped.startswith(")") or stripped.endswith(";")


def _paren_delta(line: str) -> int:
    return line.count("(") - line.count(")")


def _check_hook_positions(source: str, errors: List[Tuple[str, str]]) -> None:
    frames: List[Dict[str, Any]] = []
    depth = 0
    for line_no, line in enumerate(source.splitlines(), start=1):
        stripped = line.strip()
        starts_control = _starts_control_flow(stripped)
        current_function = _nearest_function_frame(frames)

        if stripped.startswith("return") and current_function is not None:
            current_function["return_seen"] = True

        if HOOK_CALL_RE.search(line):
            legal_function = _nearest_legal_hook_function(frames)
            if legal_function is None:
                errors.append(("react_hook_outside_function", f"React Hook call must be inside a component or custom hook at line {line_no}"))
            if starts_control or _has_control_since(frames, legal_function):
                errors.append(("react_hook_in_control_flow", f"React Hook call must not be inside conditional or loop control flow at line {line_no}"))
            if legal_function is not None and legal_function.get("return_seen"):
                errors.append(("react_hook_after_return", f"React Hook call must not appear after return at line {line_no}"))

        new_frames = _frames_started_by_line(line, stripped, depth)
        frames.extend(new_frames)
        depth = max(0, depth + _brace_delta(line))
        while frames and depth < frames[-1]["end_depth"]:
            frames.pop()


def _starts_control_flow(stripped: str) -> bool:
    return bool(CONTROL_RE.match(stripped))


def _nearest_function_frame(frames: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    for frame in reversed(frames):
        if frame["kind"] in {"component", "custom_hook", "ordinary_function"}:
            return frame
    return None


def _nearest_legal_hook_function(frames: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    current_function = _nearest_function_frame(frames)
    if current_function is None:
        return None
    if current_function["kind"] in {"component", "custom_hook"}:
        return current_function
    return None


def _has_control_since(frames: List[Dict[str, Any]], function_frame: Optional[Dict[str, Any]]) -> bool:
    if function_frame is None:
        return False
    index = -1
    for current_index, frame in enumerate(frames):
        if frame is function_frame:
            index = current_index
            break
    if index < 0:
        return False
    return any(frame["kind"] == "control" for frame in frames[index + 1 :])


def _frames_started_by_line(line: str, stripped: str, depth: int) -> List[Dict[str, Any]]:
    if "{" not in line:
        return []

    frames: List[Dict[str, Any]] = []
    function_kind = _named_function_kind(line)
    if function_kind:
        frames.append(_frame(function_kind, depth))

    starts_named_function = function_kind is not None
    starts_arrow_callback = "=>" in line and not starts_named_function
    starts_anonymous_function = bool(re.search(r"\bfunction\s*\(", line)) and not starts_named_function
    if starts_arrow_callback or starts_anonymous_function:
        frames.append(_frame("ordinary_function", depth))

    if _starts_control_flow(stripped):
        frames.append(_frame("control", depth))
    return frames


def _named_function_kind(line: str) -> Optional[str]:
    match = FUNCTION_DECL_RE.search(line)
    if not match:
        match = ARROW_ASSIGN_RE.search(line)
    if not match:
        return None
    name = match.group(1)
    if _is_custom_hook_name(name):
        return "custom_hook"
    if _is_component_name(name):
        return "component"
    return "ordinary_function"


def _is_component_name(name: str) -> bool:
    return bool(name) and name[0].isupper()


def _is_custom_hook_name(name: str) -> bool:
    return bool(re.match(r"^use[A-Z0-9]", name))


def _frame(kind: str, depth: int) -> Dict[str, Any]:
    return {
        "kind": kind,
        "end_depth": depth + 1,
        "return_seen": False,
    }


def _brace_delta(line: str) -> int:
    return line.count("{") - line.count("}")
