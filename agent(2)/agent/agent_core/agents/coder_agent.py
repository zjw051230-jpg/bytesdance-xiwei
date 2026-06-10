import json
import os
import re
from pathlib import Path, PureWindowsPath
from typing import Any, Dict, Optional

from agent_core.interfaces.llm_adapter import get_default_llm_adapter
from agent_core.observability.llm_metrics import build_llm_call_metric, now_ms
from agent_core.patches.code_patch import build_code_patch
from agent_core.skills.registry import resolve_skill


ALLOWED_LLM_PATCH_OPERATIONS = {"create_file", "replace_file", "append_text"}


def _strip_json_fence(text: str) -> str:
    stripped = (text or "").strip()
    if stripped.startswith("```"):
        lines = stripped.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        stripped = "\n".join(lines).strip()
    return stripped


def _is_safe_patch_path(path: str) -> bool:
    if not isinstance(path, str) or not path.strip():
        return False
    normalized = path.replace("\\", "/")
    if Path(path).is_absolute() or PureWindowsPath(path).drive or normalized.startswith("/"):
        return False
    if ".." in [part for part in normalized.split("/") if part]:
        return False
    return True


def _create_file_patch_from_requirement(user_input: str) -> Optional[Dict[str, Any]]:
    text = user_input or ""
    match = re.search(r"创建\s*([A-Za-z0-9_.\-/\\]+)\s*文件.*?内容为\s*(.+)", text)
    if not match and "?" in text:
        match = re.search(r"([A-Za-z0-9_.\-/\\]+)\s+\?+\s+(.+)", text)
    if not match:
        return None

    return {
        "patches": [
            {
                "operation": "create_file",
                "path": match.group(1).strip(),
                "content": match.group(2).strip(),
                "reason": "User requested creating a file with explicit content",
                "risk_level": "low",
            }
        ],
        "summary": "Prepare a structured create_file patch operation.",
    }


def _read_repo_file(repo_adapter, file_path: str) -> str:
    if repo_adapter is None or not hasattr(repo_adapter, "read_file"):
        return ""
    result = repo_adapter.read_file(file_path)
    if isinstance(result, dict) and result.get("ok") is True:
        return str(result.get("content") or "")
    return ""


def _article_stats_after(before: str) -> str:
    return _article_stats_after_structured(before)


def _article_stats_after_structured(before: str) -> str:
    helper = (
        "const articleBodyText = String(body || \"\");\n"
        "const wordCount = articleBodyText.trim()\n"
        "  ? articleBodyText.trim().split(/\\s+/).length\n"
        "  : 0;\n"
        "const readingTime = Math.max(1, Math.ceil(wordCount / 200));"
    )
    render = (
        "<p className=\"article-stats\">\n"
        "  {wordCount} words · {readingTime} min read\n"
        "</p>"
    )
    if not before:
        return (
            "export default function Article({ article }) {\n"
            "  const body = article?.body;\n"
            f"{_indent_block(helper, '  ')}\n"
            "  return (\n"
            "    <article>\n"
            f"      {render.replace(chr(10), chr(10) + '      ')}\n"
            "    </article>\n"
            "  );\n"
            "}\n"
        )
    if "wordCount" in before and "readingTime" in before:
        return before
    lines = before.splitlines()
    return_at = _find_component_return_line(lines)
    if return_at is None:
        return _generic_after(before, ["Add word count calculation", "Add reading time calculation", "Render article stats"])

    indent = _line_indent(lines[return_at])
    helper_text = _indent_block(helper, indent)
    lines[return_at:return_at] = helper_text.splitlines()
    return_at += len(helper_text.splitlines())

    if _is_single_line_return(lines[return_at]):
        lines = _expand_single_line_return(lines, return_at)
        return_at = _find_component_return_line(lines) or return_at

    render_text = _indent_block(render, indent + "    ")
    insert_at = _find_stats_render_insert_line(lines, return_at)
    lines[insert_at:insert_at] = render_text.splitlines()
    return "\n".join(lines) + ("\n" if before.endswith("\n") else "")


def _line_indent(line: str) -> str:
    return line[: len(line) - len(line.lstrip())]


def _indent_block(text: str, indent: str) -> str:
    return "\n".join(indent + line if line else line for line in text.splitlines())


def _brace_delta(line: str) -> int:
    stripped = re.sub(r"(['\"]).*?\1", "", line)
    return stripped.count("{") - stripped.count("}")


def _find_component_return_line(lines: list) -> Optional[int]:
    depth = 0
    in_component = False
    for index, line in enumerate(lines):
        stripped = line.strip()
        if re.search(r"\bfunction\s+[A-Z][A-Za-z0-9_]*\b|(?:const|let|var)\s+[A-Z][A-Za-z0-9_]*\s*=", line):
            in_component = True
        if in_component and depth == 1 and stripped.startswith("return"):
            return index
        depth += _brace_delta(line)
    for index, line in enumerate(lines):
        if line.strip().startswith("return"):
            return index
    return None


def _is_single_line_return(line: str) -> bool:
    stripped = line.strip()
    return stripped.startswith("return ") and stripped.endswith(";") and "<" in stripped


def _expand_single_line_return(lines: list, return_at: int) -> list:
    line = lines[return_at]
    indent = _line_indent(line)
    expression = line.strip()[len("return ") :].rstrip(";")
    return lines[:return_at] + [
        f"{indent}return (",
        f"{indent}  <>",
        f"{indent}    {expression}",
        f"{indent}  </>",
        f"{indent});",
    ] + lines[return_at + 1 :]


def _find_stats_render_insert_line(lines: list, return_at: int) -> int:
    for index in range(return_at + 1, len(lines)):
        if "ArticleTags" in lines[index]:
            return index
    body_markers = ("ReactMarkdown", "Markdown", "article.body", "{body}", "body")
    for index in range(return_at + 1, len(lines)):
        line = lines[index]
        if any(marker in line for marker in body_markers):
            return index + 1
        if line.strip().startswith(");"):
            return index
    return min(return_at + 1, len(lines))


def _generic_after(before: str, changes: list) -> str:
    note = "\n".join(f"// Agent patch note: {item}" for item in changes if isinstance(item, str) and item.strip())
    if not note:
        note = "// Agent patch note: requested behavior update"
    if not before:
        return note + "\n"
    return str(before).rstrip() + "\n" + note + "\n"


def _cover_image_after(file_path: str, before: str) -> str:
    normalized = str(file_path or "").replace("\\", "/").lower()
    if not before:
        return ""
    if "frontend/" in normalized:
        if "editor" in normalized or "form" in normalized:
            return _cover_image_editor_after(before)
        if "article" in normalized and "service" not in normalized and "api" not in normalized:
            return _cover_image_detail_after(before)
        if "getarticle" in normalized:
            return before
        if "service" in normalized or "api" in normalized or "setarticle" in normalized:
            return _cover_image_api_after(before)
    if "backend/" in normalized:
        if "model" in normalized or "/models/" in normalized:
            return _cover_image_model_after(before)
        if any(part in normalized for part in ("/routes/", "/controllers/", "/services/")):
            return _cover_image_backend_api_after(before)
    return before


def _cover_image_model_after(before: str) -> str:
    lines = before.splitlines()
    field_type = "DataTypes.STRING" if "DataTypes" in before else "String"
    for index, line in enumerate(lines):
        if "body" in line and ":" in line:
            indent = _line_indent(line)
            lines.insert(index + 1, f"{indent}coverImage: {field_type},")
            return "\n".join(lines) + ("\n" if before.endswith("\n") else "")
        if "description" in line and ":" in line:
            indent = _line_indent(line)
            lines.insert(index + 1, f"{indent}coverImage: {field_type},")
            return "\n".join(lines) + ("\n" if before.endswith("\n") else "")
    for index, line in enumerate(lines):
        if line.strip() in ("});", "})", "};", "}"):
            indent = _line_indent(line) + "  "
            lines.insert(index, f"{indent}coverImage: {field_type},")
            return "\n".join(lines) + ("\n" if before.endswith("\n") else "")
    return before.rstrip() + f"\n\nArticle.schema = {{ ...(Article.schema || {{}}), coverImage: {field_type} }};\n"


def _cover_image_backend_api_after(before: str) -> str:
    after = before
    after = re.sub(r"\{([^{}\n]*(?:title|body|description)[^{}\n]*)\}\s*=\s*req\.body", _add_cover_to_destructure, after, count=1)
    after = re.sub(r"\{([^{}\n]*(?:title|body|description)[^{}\n]*)\}\s*=\s*request\.body", _add_cover_to_destructure, after, count=1)
    after = re.sub(r"((?:title|body|description),\s*)", r"\1coverImage, ", after, count=1)
    if after != before:
        return after
    lines = before.splitlines()
    for index, line in enumerate(lines):
        if "req.body" in line or "request.body" in line:
            indent = _line_indent(line)
            lines.insert(index + 1, f"{indent}const coverImage = req.body?.coverImage || request?.body?.coverImage || '';")
            return "\n".join(lines) + ("\n" if before.endswith("\n") else "")
    return before.rstrip() + "\n\nconst normalizeCoverImage = (article) => ({ ...article, coverImage: article.coverImage || '' });\n"


def _add_cover_to_destructure(match) -> str:
    content = match.group(1)
    if "coverImage" in content:
        return match.group(0)
    return match.group(0).replace(content, content.rstrip() + ", coverImage")


def _cover_image_editor_after(before: str) -> str:
    lines = before.splitlines()
    lines = _ensure_cover_image_in_initial_object(lines)
    lines = _ensure_cover_image_in_form_destructure(lines)
    lines = _ensure_cover_image_in_submit_payload(lines)

    input_block = (
        "<input\n"
        "  type=\"url\"\n"
        "  name=\"coverImage\"\n"
        "  value={coverImage}\n"
        "  onChange={(event) => setForm((form) => ({ ...form, coverImage: event.target.value }))}\n"
        "  placeholder=\"Cover image URL\"\n"
        "/>"
    )
    if not _has_cover_image_input(lines):
        lines = _insert_cover_image_input(lines, input_block)
    return "\n".join(lines) + ("\n" if before.endswith("\n") else "")


def _has_cover_image_state(lines: list) -> bool:
    return any("coverImage" in line and ("useState" in line or "setCoverImage" in line) for line in lines)


def _has_cover_image_input(lines: list) -> bool:
    return any("name=\"coverImage\"" in line or "name='coverImage'" in line for line in lines)


def _ensure_cover_image_in_initial_object(lines: list) -> list:
    if any(re.search(r"\bcoverImage\s*:", line) for line in lines):
        return lines
    for index, line in enumerate(lines):
        if re.search(r"\b(?:emptyForm|initialState)\s*=\s*\{", line):
            if "}" in line:
                lines[index] = _add_cover_image_to_inline_object_literal(line)
                return lines
            end_index = _find_object_literal_end(lines, index)
            if end_index is not None:
                for field_index in range(index + 1, end_index):
                    if re.search(r"\bbody\s*:", lines[field_index]):
                        indent = _line_indent(lines[field_index])
                        lines.insert(field_index + 1, f"{indent}coverImage: \"\",")
                        return lines
                indent = _line_indent(lines[end_index]) + "  "
                lines.insert(end_index, f"{indent}coverImage: \"\",")
                return lines
    for index, line in enumerate(lines):
        if "body" in line and ":" in line:
            indent = _line_indent(line)
            lines.insert(index + 1, f"{indent}coverImage: \"\",")
            break
    return lines


def _ensure_cover_image_in_form_destructure(lines: list) -> list:
    for index, line in enumerate(lines):
        if "coverImage" in line:
            continue
        if "useState" in line and re.search(r"const\s+\[\s*\{[^}]*\bbody\b[^}]*\}", line):
            lines[index] = _add_cover_image_to_destructure_line(line)
            return lines
        if re.search(r"const\s+\{[^}]*\bbody\b[^}]*\}\s*=\s*form\b", line):
            lines[index] = _add_cover_image_to_destructure_line(line)
            return lines
    return lines


def _ensure_cover_image_in_submit_payload(lines: list) -> list:
    if any("setArticle" in line and "coverImage" in line for line in lines):
        return lines
    for index, line in enumerate(lines):
        if "setArticle" in line and "{" in line and "}" in line and "coverImage" not in line:
            lines[index] = _add_cover_image_to_inline_object(line)
            return lines
    for index, line in enumerate(lines):
        if "body" in line and ":" in line and "coverImage" not in line:
            indent = _line_indent(line)
            lines.insert(index + 1, f"{indent}coverImage,")
            return lines
    return lines


def _add_cover_image_to_inline_object_literal(line: str) -> str:
    object_at = line.rfind("}")
    if object_at < 0:
        return line
    before_object_end = line[:object_at].rstrip()
    separator = "" if before_object_end.endswith("{") else ","
    return f"{before_object_end}{separator} coverImage: \"\" {line[object_at:]}"


def _add_cover_image_to_destructure_line(line: str) -> str:
    close_at = line.find("}")
    if close_at < 0:
        return line
    before_close = line[:close_at].rstrip()
    separator = "" if before_close.endswith("{") else ","
    return f"{before_close}{separator} coverImage {line[close_at:]}"


def _add_cover_image_to_inline_object(line: str) -> str:
    object_at = line.rfind("}")
    if object_at < 0:
        return line
    before_object_end = line[:object_at].rstrip()
    separator = "" if before_object_end.endswith("{") else ","
    return f"{before_object_end}{separator} coverImage {line[object_at:]}"


def _find_object_literal_end(lines: list, start_index: int) -> Optional[int]:
    depth = 0
    for index in range(start_index, len(lines)):
        depth += lines[index].count("{") - lines[index].count("}")
        if index > start_index and depth <= 0:
            return index
    return None


def _insert_cover_image_input(lines: list, input_block: str) -> list:
    for index, line in enumerate(lines):
        closing_at = line.lower().find("</form")
        if closing_at >= 0:
            indent = _line_indent(line) + "  "
            input_text = _indent_block(input_block, indent)
            before_close = line[:closing_at].rstrip()
            after_close = line[closing_at:]
            if before_close:
                lines[index:index + 1] = [before_close] + input_text.splitlines() + [f"{_line_indent(line)}{after_close.lstrip()}"]
            else:
                lines[index:index] = input_text.splitlines()
            return lines
    insert_at = _find_form_insert_line(lines)
    if insert_at is not None:
        indent = _line_indent(lines[insert_at])
        lines[insert_at:insert_at] = _indent_block(input_block, indent).splitlines()
    return lines


def _find_form_insert_line(lines: list) -> Optional[int]:
    for index, line in enumerate(lines):
        if "textarea" in line.lower() or "body" in line:
            return index + 1
    for index, line in enumerate(lines):
        if "<button" in line.lower() or "type=\"submit\"" in line:
            return index
    for index, line in enumerate(lines):
        if "</form" in line.lower():
            return index
    return None


def _cover_image_detail_after(before: str) -> str:
    if "article-cover-image" in before:
        return before
    lines = before.splitlines()
    for index, line in enumerate(lines):
        if "const {" in line and "article" in line and "body" in line and "coverImage" not in line:
            lines[index] = line.replace("body", "body, coverImage", 1)
            break
    else:
        return_at = _find_component_return_line(lines)
        if return_at is not None and not any("coverImage" in line for line in lines[:return_at]):
            indent = _line_indent(lines[return_at])
            lines[return_at:return_at] = [f"{indent}const coverImage = article?.coverImage;"]
            return_at += 1

    image_block = (
        "{coverImage ? (\n"
        "  <img className=\"article-cover-image\" src={coverImage} alt={title || \"Article cover\"} />\n"
        ") : null}"
    )
    return_at = _find_component_return_line(lines)
    if return_at is not None and _is_single_line_return(lines[return_at]):
        lines = _expand_single_line_return(lines, return_at)
        return_at = _find_component_return_line(lines)
    insert_at = _find_article_render_insert_line(lines, return_at)
    if insert_at is not None:
        indent = _line_indent(lines[insert_at])
        lines[insert_at:insert_at] = _indent_block(image_block, indent).splitlines()
    return "\n".join(lines) + ("\n" if before.endswith("\n") else "")


def _find_article_render_insert_line(lines: list, return_at: Optional[int]) -> Optional[int]:
    start = return_at or 0
    for index in range(start, len(lines)):
        if "<h1" in lines[index] or "title" in lines[index]:
            return index + 1
    for index in range(start, len(lines)):
        if "<article" in lines[index] or "<main" in lines[index]:
            return index + 1
    return None


def _cover_image_api_after(before: str) -> str:
    after = before
    after = re.sub(r"\{([^{}\n]*(?:title|body|description)[^{}\n]*)\}\s*\)", _add_cover_to_function_params, after, count=1)
    after = re.sub(r"article:\s*\{([^{}\n]*(?:title|body|description)[^{}\n]*)\}", _add_cover_to_article_payload, after, count=1)
    if after == before:
        after = re.sub(r"\{([^{}\n]*(?:title|body|description)[^{}\n]*)\}", _add_cover_to_object_literal, after, count=1)
    return after


def _add_cover_to_function_params(match) -> str:
    content = match.group(1)
    if "coverImage" in content:
        return match.group(0)
    return "{" + content.rstrip() + ", coverImage }" + ")"


def _add_cover_to_article_payload(match) -> str:
    content = match.group(1)
    if "coverImage" in content:
        return match.group(0)
    return "article: {" + content.rstrip() + ", coverImage }"


def _add_cover_to_object_literal(match) -> str:
    content = match.group(1)
    if "coverImage" in content:
        return match.group(0)
    return "{" + content.rstrip() + ", coverImage" + "}"


def _cover_image_patch_plan(
    user_input: str,
    matched_skill: Optional[Dict[str, Any]],
    located_files: Optional[Dict[str, Any]],
    repo_adapter=None,
) -> Dict[str, Any]:
    located_targets = _located_files_for_patch(located_files)
    if not located_targets:
        return {
            "patches": [],
            "summary": "Unable to prepare cover image CodePatch without located repository files.",
            "metadata": {"coder": "skill_registry", "skill_id": "cover-image", "error": "missing_located_files"},
        }

    selected_by_role, missing_roles = _select_cover_image_targets(located_targets)
    patches = []
    patched_roles = {}
    for role, file_path in selected_by_role.items():
        before = _read_repo_file(repo_adapter, file_path)
        after = _cover_image_after(file_path, before)
        if not before or after == before:
            if role not in missing_roles:
                missing_roles.append(role)
            continue
        patch = build_code_patch(
            file_path=file_path,
            before=before,
            after=after,
            operation="replace",
            confidence=0.74,
            extra={
                "path": file_path,
                "role": role,
                "changes": ["Add cover image support"],
                "reason": f"Generated cover image CodePatch for {role} from located Conduit file",
                "risk_level": "medium",
            },
        )
        patches.append(patch)
        patched_roles[role] = file_path

    missing_roles = [role for role in _cover_image_required_roles() if role not in patched_roles]

    return {
        "patches": patches,
        "code_patches": patches,
        "missing_roles": missing_roles,
        "role_assignments": selected_by_role,
        "summary": "Prepare executable fullstack CodePatches for article cover image support.",
        "acceptance_template": list((matched_skill or {}).get("acceptance_template") or []),
        "metadata": {
            "coder": "skill_registry",
            "skill_id": "cover-image",
            "patch_format": "code_patch",
            "located_file_count": len(located_targets),
            "selected_file_count": len(selected_by_role),
            "generated_patch_count": len(patches),
        },
    }


def _cover_image_required_roles() -> list:
    return ["model", "api_write", "editor_form", "article_detail"]


def _select_cover_image_targets(located_targets: list) -> tuple:
    selected = {}
    used = set()
    editor_form = _preferred_article_editor_form_target(located_targets)
    if editor_form:
        selected["editor_form"] = editor_form
        used.add(editor_form)
    for role in _cover_image_required_roles():
        if role in selected:
            continue
        best = _best_cover_image_target_for_role(role, located_targets, used)
        if best:
            selected[role] = best
            used.add(best)
    missing = [role for role in _cover_image_required_roles() if role not in selected]
    return selected, missing


def _preferred_article_editor_form_target(located_targets: list) -> Optional[str]:
    preferred = "frontend/src/components/articleeditorform/articleeditorform.jsx"
    for path in located_targets:
        normalized = _normalize_cover_image_path(path)
        if normalized == preferred:
            return path
    for path in located_targets:
        normalized = _normalize_cover_image_path(path)
        if normalized.endswith("/" + preferred):
            return path
    return None


def _best_cover_image_target_for_role(role: str, located_targets: list, used: set) -> Optional[str]:
    scored = []
    for path in located_targets:
        if path in used:
            continue
        score = _cover_image_role_score(role, path)
        if score > 0:
            scored.append((score, len(path), path))
    if not scored:
        return None
    scored.sort(key=lambda item: (-item[0], item[1], item[2]))
    return scored[0][2]


def _cover_image_role_score(role: str, path: str) -> int:
    normalized = _normalize_cover_image_path(path)
    basename = normalized.rsplit("/", 1)[-1]
    if _is_unrelated_cover_image_candidate(normalized):
        return 0
    if role == "model":
        score = 0
        if normalized.startswith("backend/") and "/models/" in normalized:
            score += 5
        if "article" in basename:
            score += 4
        return score if score >= 8 else 0
    if role == "api_write":
        if "setarticle" in basename:
            return 9
        score = 0
        if normalized.startswith("backend/") and any(part in normalized for part in ("/routes/", "/controllers/", "/services/")):
            score += 5
        if "article" in normalized:
            score += 3
        if any(token in normalized for token in ("create", "update", "set", "post", "put")):
            score += 2
        return score if score >= 8 else 0
    if role == "api_read":
        if "getarticle" in basename:
            return 9
        score = 0
        if normalized.startswith("backend/") and any(part in normalized for part in ("/routes/", "/controllers/", "/services/")):
            score += 4
        if "article" in normalized:
            score += 3
        if any(token in normalized for token in ("read", "get", "show", "detail")):
            score += 2
        return score if score >= 8 else 0
    if role == "editor_form":
        if "articleeditorform" in normalized:
            return 10
        if "articleeditor" in normalized:
            return 9
        if "editor" in basename and "article" in normalized:
            return 8
        return 0
    if role == "article_detail":
        if normalized.endswith("frontend/src/routes/article/article.jsx"):
            return 10
        if normalized.endswith("frontend/src/pages/article.jsx"):
            return 9
        if normalized.startswith("frontend/") and "article" in normalized and basename in {"article.jsx", "article.tsx"}:
            return 8
        return 0
    return 0


def _is_unrelated_cover_image_candidate(normalized_path: str) -> bool:
    unrelated_tokens = (
        "loginform",
        "signupform",
        "settingsform",
        "commenteditor",
        "articlespreview",
        "articleauthorbuttons",
        "homearticles",
        "profilearticles",
        "profilefavarticles",
        "usearticles",
    )
    return any(token in normalized_path for token in unrelated_tokens)


def _code_patch_for_item(user_input: str, matched_skill: Optional[Dict[str, Any]], patch: Dict[str, Any], repo_adapter=None) -> Dict[str, Any]:
    file_path = patch.get("file") or patch.get("path") or "frontend/src/pages/Article.jsx"
    changes = list(patch.get("changes") or [])
    before = _read_repo_file(repo_adapter, file_path)
    skill_id = matched_skill.get("id") if isinstance(matched_skill, dict) else None
    text = " ".join([user_input or "", skill_id or "", " ".join(str(item) for item in changes)]).lower()
    if "word count" in text or "reading time" in text or skill_id == "article-word-stats":
        after = _article_stats_after(before)
        confidence = 0.78 if before else 0.62
    elif skill_id == "cover-image":
        after = _cover_image_after(file_path, before)
        confidence = 0.74 if before and after != before else 0.42
    else:
        after = _generic_after(before, changes)
        confidence = 0.64 if before else 0.52
    result = build_code_patch(
        file_path=file_path,
        before=before,
        after=after,
        operation="replace",
        confidence=confidence,
        extra={
            "path": file_path,
            "changes": changes,
            "reason": patch.get("reason") or "Generated code patch from patch strategy",
            "risk_level": patch.get("risk_level", "low"),
        },
    )
    return result


def _upgrade_to_code_patches(
    patch_plan: Dict[str, Any],
    user_input: str,
    matched_skill: Optional[Dict[str, Any]],
    repo_adapter=None,
) -> Dict[str, Any]:
    if not isinstance(patch_plan, dict) or not isinstance(patch_plan.get("patches"), list):
        return patch_plan
    patches = []
    code_patches = []
    for patch in patch_plan.get("patches", []) or []:
        if not isinstance(patch, dict):
            continue
        if patch.get("diff") and patch.get("after_snippet") is not None:
            upgraded = dict(patch)
        elif patch.get("operation") in {"create_file", "replace_file", "append_text"} and patch.get("content"):
            patches.append(patch)
            continue
        else:
            upgraded = _code_patch_for_item(user_input, matched_skill, patch, repo_adapter=repo_adapter)
        patches.append(upgraded)
        code_patches.append(upgraded)
    result = dict(patch_plan)
    if patches:
        result["patches"] = patches
    if code_patches:
        result["code_patches"] = code_patches
        result.setdefault("metadata", {})["patch_format"] = "code_patch"
    return result


def _rule_patch_plan(
    user_input: str,
    matched_skill: Optional[Dict[str, Any]],
    plan: Optional[Dict[str, Any]],
    located_files: Optional[Dict[str, Any]],
    historical_recall: Optional[Dict[str, Any]] = None,
    repo_adapter=None,
    upgrade_code_patches: bool = True,
) -> Dict[str, Any]:
    matched_skill = resolve_skill(matched_skill)
    structured_patch = _create_file_patch_from_requirement(user_input)
    if structured_patch is not None:
        return structured_patch

    located_targets = _located_files_for_patch(located_files)
    if not located_targets and isinstance(historical_recall, dict):
        located_targets = [
            item
            for item in historical_recall.get("reusable_file_hints", []) or []
            if isinstance(item, str) and item.strip()
        ]
    if isinstance(matched_skill, dict) and matched_skill.get("patch_strategy"):
        if matched_skill.get("id") == "cover-image":
            return _cover_image_patch_plan(user_input, matched_skill, located_files, repo_adapter=repo_adapter)
        strategy = matched_skill.get("patch_strategy") or {}
        target_modules = []
        if isinstance(plan, dict):
            target_modules = list(plan.get("target_modules") or plan.get("target_files_hint") or [])
        if not target_modules:
            target_modules = list(matched_skill.get("target_modules") or [])
        patches = []
        for index, patch in enumerate(strategy.get("patches") or []):
            if not isinstance(patch, dict):
                continue
            item = dict(patch)
            if not item.get("file") and not item.get("path"):
                fallback_target = None
                if index < len(located_targets):
                    fallback_target = located_targets[index]
                elif located_targets:
                    fallback_target = located_targets[0]
                elif index < len(target_modules):
                    fallback_target = target_modules[index]
                elif target_modules:
                    fallback_target = target_modules[0]
                item["file"] = fallback_target or "frontend/src/pages/Article.jsx"
            patches.append(item)
        if patches:
            result = {
                "patches": patches,
                "summary": strategy.get("summary") or "Prepare patch plan from matched skill strategy.",
                "acceptance_template": list(matched_skill.get("acceptance_template") or []),
                "metadata": {
                    "coder": "skill_registry",
                    "skill_id": matched_skill.get("id"),
                },
            }
            if isinstance(historical_recall, dict) and historical_recall.get("patch_strategy_hints"):
                result["metadata"]["historical_recall"] = {
                    "previous_changed_files": list(historical_recall.get("reusable_file_hints") or []),
                    "patch_strategy_hints": list(historical_recall.get("patch_strategy_hints") or []),
                }
            return _upgrade_to_code_patches(result, user_input, matched_skill, repo_adapter=repo_adapter) if upgrade_code_patches else result

    located_target = _best_located_file(located_files)
    if isinstance(matched_skill, dict) and matched_skill.get("id") == "cover-image":
        located_targets = _located_files_for_patch(located_files)
        result = {
            "patches": [
                {
                    "file": located_targets[0] if len(located_targets) > 0 else "backend/src/models/Article.js",
                    "reason": "Article model should store cover image metadata",
                    "changes": ["Add cover image field"],
                    "risk_level": "medium",
                },
                {
                    "file": located_targets[1] if len(located_targets) > 1 else "frontend/src/pages/Editor.jsx",
                    "reason": "Article editor should accept cover image input",
                    "changes": ["Add cover image upload field"],
                    "risk_level": "medium",
                },
            ],
            "summary": "Prepare a medium-risk fullstack patch for article cover image support.",
        }
        return _upgrade_to_code_patches(result, user_input, matched_skill, repo_adapter=repo_adapter) if upgrade_code_patches else result

    result = {
        "patches": [
            {
                "file": located_target or "frontend/src/pages/Article.jsx",
                "reason": "Generic patch plan placeholder based on the current requirement",
                "changes": ["Clarify implementation scope", "Locate relevant modules", "Prepare targeted changes"],
                "risk_level": "low",
            }
        ],
        "summary": "Prepare a generic patch plan for the current requirement.",
    }
    if isinstance(historical_recall, dict) and historical_recall.get("patch_strategy_hints"):
        result["metadata"] = {
            "historical_recall": {
                "previous_changed_files": list(historical_recall.get("reusable_file_hints") or []),
                "patch_strategy_hints": list(historical_recall.get("patch_strategy_hints") or []),
                "note": "Historical patch content is not reused directly.",
            }
        }
    return _upgrade_to_code_patches(result, user_input, matched_skill, repo_adapter=repo_adapter) if upgrade_code_patches else result


def _located_files_for_patch(located_files: Optional[Dict[str, Any]]) -> list:
    if not isinstance(located_files, dict) or not located_files.get("located"):
        return []

    files = []
    for item in located_files.get("files", []) or []:
        if not isinstance(item, dict):
            continue
        path = item.get("relative_path") or item.get("path")
        path = _cover_image_relative_path(path)
        if isinstance(path, str) and path.strip() and path not in files:
            files.append(path)
    return files


def _cover_image_relative_path(path: Any) -> Optional[str]:
    if not isinstance(path, str) or not path.strip():
        return None
    normalized = path.replace("\\", "/").strip()
    lowered = normalized.lower()
    for marker in ("frontend/src/", "backend/src/", "backend/models/", "backend/routes/", "backend/controllers/", "frontend/src/"):
        index = lowered.find(marker)
        if index >= 0:
            return normalized[index:]
    return normalized


def _normalize_cover_image_path(path: Any) -> str:
    relative = _cover_image_relative_path(path)
    return str(relative or "").replace("\\", "/").lower().strip("/")


def _best_located_file(located_files: Optional[Dict[str, Any]]) -> Optional[str]:
    files = _located_files_for_patch(located_files)
    return files[0] if files else None


def _l3_kind(matched_skill: Optional[Dict[str, Any]], plan: Optional[Dict[str, Any]]) -> Optional[str]:
    plan = plan if isinstance(plan, dict) else {}
    skill = matched_skill if isinstance(matched_skill, dict) else {}
    text = " ".join(
        [
            str(plan.get("requirement_type") or ""),
            str(plan.get("scope") or ""),
            str(plan.get("skill_id") or ""),
            str(plan.get("skill_name") or ""),
            str(skill.get("id") or ""),
            str(skill.get("name") or ""),
        ]
    ).lower()
    if "conduit_l3_ambiguous" in text or "clarify-first" in text:
        return "ambiguous"
    if "conduit_l3_conflict" in text or "conflict-detection" in text:
        return "conflict"
    if "conduit_l3_multimodule" in text or "multi-module-planning" in text:
        return "multimodule"
    return None


def _l3_patch_plan(
    user_input: str,
    matched_skill: Optional[Dict[str, Any]],
    plan: Optional[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    kind = _l3_kind(matched_skill, plan)
    if not kind:
        return None
    plan = plan if isinstance(plan, dict) else {}
    if kind == "conflict":
        status = "blocked"
    elif kind == "multimodule":
        status = "planning_paused"
    else:
        status = "clarification_required"
    result = {
        "patches": [],
        "code_patches": [],
        "summary": "No code patch generated for L3 requirement before clarification or conflict resolution.",
        "status": status,
        "requirement_type": plan.get("requirement_type"),
        "clarification_questions": list(plan.get("clarification_questions") or []),
        "metadata": {
            "coder": "skill_registry",
            "skill_id": (matched_skill or {}).get("id") or plan.get("skill_id"),
            "l3_kind": kind,
            "workflow_status": status,
            "requires_clarification": True,
            "allow_code_patches": False,
            "stop_before_execute": True,
            "user_input": user_input,
        },
    }
    if kind == "ambiguous":
        result["possible_interpretations"] = list(plan.get("possible_interpretations") or [])
        result["summary"] = "Clarification required before modern article experience changes can be scoped."
    elif kind == "conflict":
        result["conflict_reason"] = plan.get("conflict_reason") or "Requirement constraints conflict with the requested persistent feature."
        result["feasible_alternatives"] = list(plan.get("feasible_alternatives") or [])
        result["summary"] = "Patch generation blocked because the requirement conflicts with its constraints."
    else:
        result["staged_plan"] = dict(plan.get("staged_plan") or {})
        result["summary"] = "Staged multi-module plan prepared; code patches are blocked until rating policy is clarified."
    return result


def _fallback_patch_plan(user_input, matched_skill, plan, located_files, reason: str, metric: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    fallback = _rule_patch_plan(user_input, matched_skill, plan, located_files, upgrade_code_patches=False)
    fallback["metadata"] = {"llm_coder_fallback_reason": reason}
    if metric:
        fallback.setdefault("llm_metrics", []).append(metric)
    return fallback


def _generate_llm_patch_plan(user_input, matched_skill, plan, located_files, llm_adapter=None) -> Dict[str, Any]:
    adapter = llm_adapter or get_default_llm_adapter()
    system_prompt = (
        "You are a code patch generator. Return JSON only. "
        "Only output structured patch operations: create_file, replace_file, append_text. "
        "Never output natural-language changes."
    )
    prompt = (
        f"Requirement:\n{user_input}\n\n"
        f"Matched skill:\n{matched_skill}\n\n"
        f"Plan:\n{plan}\n\n"
        f"Located files:\n{located_files}\n\n"
        'Return JSON: {"patches":[{"operation":"create_file","path":"note.txt","content":"100"}]}'
    )
    started_ms = now_ms()
    result = adapter.generate(prompt=prompt, system_prompt=system_prompt, temperature=0.2)
    metric = build_llm_call_metric("coder", result, prompt=prompt, system_prompt=system_prompt, started_ms=started_ms)
    if not result.get("ok"):
        return _fallback_patch_plan(user_input, matched_skill, plan, located_files, result.get("error") or "llm_generate_failed", metric=metric)

    try:
        data = json.loads(_strip_json_fence(result.get("text", "")))
    except (TypeError, ValueError) as exc:
        return _fallback_patch_plan(user_input, matched_skill, plan, located_files, f"invalid_json: {exc}", metric=metric)

    if not isinstance(data, dict) or not isinstance(data.get("patches"), list) or not data["patches"]:
        return _fallback_patch_plan(user_input, matched_skill, plan, located_files, "invalid_patch_root", metric=metric)

    patches = []
    for patch in data["patches"]:
        if not isinstance(patch, dict):
            return _fallback_patch_plan(user_input, matched_skill, plan, located_files, "patch_not_object", metric=metric)
        operation = patch.get("operation")
        path = patch.get("path")
        content = patch.get("content")
        if operation not in ALLOWED_LLM_PATCH_OPERATIONS:
            return _fallback_patch_plan(user_input, matched_skill, plan, located_files, "unsupported_operation", metric=metric)
        if not _is_safe_patch_path(path):
            return _fallback_patch_plan(user_input, matched_skill, plan, located_files, "unsafe_path", metric=metric)
        if not isinstance(content, str) or content == "":
            return _fallback_patch_plan(user_input, matched_skill, plan, located_files, "empty_content", metric=metric)
        patches.append(
            {
                "operation": operation,
                "path": path,
                "content": content,
                "reason": "LLM generated structured patch operation",
                "risk_level": "low",
            }
        )

    return {
        "patches": patches,
        "summary": "Prepare structured patch operations generated by LLM.",
        "metadata": {
            "coder": "llm",
            "provider": result.get("provider"),
            "model": result.get("model"),
        },
        "llm_metrics": [metric],
    }


def generate_patch_plan(
    user_input: str,
    matched_skill: Optional[Dict[str, Any]],
    plan: Optional[Dict[str, Any]],
    located_files: Optional[Dict[str, Any]],
    llm_adapter=None,
    historical_recall: Optional[Dict[str, Any]] = None,
    repo_adapter=None,
) -> Dict[str, Any]:
    l3_plan = _l3_patch_plan(user_input, matched_skill, plan)
    if l3_plan is not None:
        return l3_plan

    if os.getenv("AGENT_USE_LLM_CODER") == "1":
        return _generate_llm_patch_plan(user_input, matched_skill, plan, located_files, llm_adapter=llm_adapter)

    return _rule_patch_plan(user_input, matched_skill, plan, located_files, historical_recall=historical_recall, repo_adapter=repo_adapter)
