import re
from typing import Any, Dict, List, Optional

from agent_core.skills.registry import resolve_skill


DANGEROUS_PATTERNS = (
    "/tests/",
    "\\tests\\",
    ".test.js",
    ".spec.js",
    "package-lock.json",
    "yarn.lock",
    ".env",
)


def review_patch_plan(
    plan: Optional[Dict[str, Any]],
    located_files: Optional[Dict[str, Any]],
    patch_plan: Optional[Dict[str, Any]],
    matched_skill: Optional[Dict[str, Any]] = None,
    historical_recall: Optional[Dict[str, Any]] = None,
    validation_result: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    plan = plan or {}
    patch_plan = patch_plan or {}
    matched_skill = resolve_skill(matched_skill) or {}

    issues: List[str] = []
    required_fixes: List[str] = []
    approved = True
    risk_level = "low"

    if isinstance(validation_result, dict) and validation_result.get("approved") is False:
        approved = False
        risk_level = "high"
        issues.append("Patch validation failed")
        for error in validation_result.get("errors", []) or []:
            if isinstance(error, dict):
                message = error.get("message") or error.get("code") or "Validation error"
                file_path = error.get("file")
                issues.append(f"{file_path}: {message}" if file_path else str(message))
            elif isinstance(error, str):
                issues.append(error)
        required_fixes.append("Fix patch validation errors before review or execution")

    if not isinstance(patch_plan, dict) or not patch_plan.get("patches"):
        approved = False
        risk_level = "high"
        issues.append("Missing patch plan")
        required_fixes.append("Provide a non-empty patch plan before review")

    patches = patch_plan.get("patches", []) if isinstance(patch_plan, dict) else []
    if len(patches) > 8:
        approved = False
        risk_level = "high"
        issues.append("Patch plan touches too many files")
        required_fixes.append("Reduce patch scope to the core files required for the change")
    if isinstance(patch_plan, dict) and patch_plan.get("missing_roles"):
        risk_level = "high" if risk_level == "high" else "medium"
        issues.append("Patch plan is missing role coverage: " + ", ".join(str(role) for role in patch_plan.get("missing_roles") or []))
    located_paths = _extract_located_paths(located_files)
    if matched_skill.get("id") == "cover-image":
        editor_form_path = _located_article_editor_form_path(located_paths)
        role_assignments = patch_plan.get("role_assignments") if isinstance(patch_plan, dict) else {}
        assigned_editor = role_assignments.get("editor_form") if isinstance(role_assignments, dict) else None
        if editor_form_path and not _paths_match(str(assigned_editor or ""), editor_form_path):
            approved = False
            risk_level = "high"
            issues.append(f"Located ArticleEditorForm must be assigned to editor_form: {editor_form_path}")
            required_fixes.append("Regenerate cover-image patch plan with ArticleEditorForm as editor_form")
    patch_paths = []
    for patch in patches:
        if not isinstance(patch, dict):
            approved = False
            risk_level = "high"
            issues.append("Patch entry is not an object")
            continue
        file_path = patch.get("file") or patch.get("path") or ""
        if file_path:
            patch_paths.append(file_path)
        if _is_code_patch(patch) and not str(patch.get("diff") or "").strip():
            approved = False
            risk_level = "high"
            issues.append("CodePatch diff is empty")
        if _is_code_patch(patch) and _contains_todo_patch(patch):
            approved = False
            risk_level = "high"
            issues.append("CodePatch contains TODO placeholder instead of executable code")
            required_fixes.append("Replace TODO placeholders with concrete code changes")
        invalid_js_issue = _cover_image_invalid_js_issue(patch) if matched_skill.get("id") == "cover-image" else None
        if invalid_js_issue:
            approved = False
            risk_level = "high"
            issues.append(invalid_js_issue)
            required_fixes.append("Regenerate cover-image CodePatch with valid JavaScript and Sequelize field syntax")
        if (
            patch.get("operation") == "replace"
            and _is_code_patch(patch)
            and not str(patch.get("before_snippet") or "").strip()
            and _requires_real_before_snippet(located_files, matched_skill)
        ):
            approved = False
            risk_level = "high"
            issues.append(f"replace CodePatch has empty before_snippet for {file_path or 'unknown file'}")
            required_fixes.append("Read the real target file before generating a replace CodePatch")
        patch_risk = patch.get("risk_level", "low")
        if patch_risk == "high":
            approved = False
            risk_level = "high"
            issues.append("High risk patch detected")

        if any(token in file_path for token in DANGEROUS_PATTERNS):
            approved = False
            risk_level = "high"
            issues.append(f"Dangerous file in patch plan: {file_path}")
        if matched_skill.get("id") == "cover-image" and _is_unrelated_cover_image_patch_file(file_path):
            approved = False
            risk_level = "high"
            issues.append(f"Unrelated file in cover-image patch plan: {file_path}")

    summary_parts = [patch_plan.get("summary", "") if isinstance(patch_plan, dict) else ""]
    for patch in patches:
        if not isinstance(patch, dict):
            continue
        summary_parts.extend(patch.get("changes", []))
        if isinstance(patch.get("diff"), str):
            summary_parts.append(patch.get("diff"))
    summary_text = " ".join(part for part in summary_parts if isinstance(part, str))
    acceptance_criteria = plan.get("acceptance_criteria", []) if isinstance(plan, dict) else []
    acceptance_template = matched_skill.get("acceptance_template") or plan.get("acceptance_template") or acceptance_criteria
    acceptance_keywords = _acceptance_keywords(acceptance_template)
    if acceptance_criteria and acceptance_keywords and not any(keyword in summary_text.lower() for keyword in acceptance_keywords):
        issues.append("Patch plan may not fully cover acceptance criteria")

    if isinstance(patch_plan, dict) and patch_plan.get("patches"):
        for patch in patch_plan["patches"]:
            if not isinstance(patch, dict):
                continue
            changes = " ".join(patch.get("changes", [])).lower()
            diff_text = str(patch.get("diff") or "").lower()
            file_path = patch.get("file", "")
            skill_name = (plan or {}).get("skill_name", "") or ""
            summary_text = (patch_plan.get("summary", "") or "")
            required_terms = _acceptance_keywords(matched_skill.get("acceptance_template") or [])
            if required_terms and not any(term in changes or term in diff_text or term in summary_text.lower() for term in required_terms):
                approved = False
                issues.append(f"Patch plan is missing acceptance template coverage for {skill_name or matched_skill.get('name')}")

    risk_rules = matched_skill.get("risk_rules") if isinstance(matched_skill.get("risk_rules"), dict) else {}
    backend_risk = risk_rules.get("backend_prefix") or "medium"
    if any(isinstance(patch, dict) and patch.get("file", "").startswith("backend/") for patch in patches):
        risk_level = backend_risk if risk_level == "low" else risk_level

    matches_located_files = True
    if located_paths and patch_paths:
        matches_located_files = any(_paths_match(patch_path, located_path) for patch_path in patch_paths for located_path in located_paths)
        if not matches_located_files:
            approved = False
            risk_level = "high"
            issues.append("Patch plan does not target any located file candidate")
            required_fixes.append("Regenerate patch plan using files from locator candidates")

    checks = {
        "has_patch_plan": bool(isinstance(patch_plan, dict) and patch_plan.get("patches")),
        "has_code_patch": any(_is_code_patch(patch) for patch in patches if isinstance(patch, dict)),
        "matches_acceptance_criteria": not any("acceptance criteria" in issue.lower() for issue in issues),
        "regression_risk_checked": True,
        "dangerous_files_checked": True,
        "matches_located_files": matches_located_files,
        "validation_approved": validation_result.get("approved") if isinstance(validation_result, dict) else None,
    }

    if not issues:
        summary = "Patch plan is acceptable for the next execution phase."
    else:
        summary = "Patch plan has review issues that should be resolved before execution."

    historical_risks = []
    if isinstance(historical_recall, dict):
        historical_risks = [
            item
            for item in historical_recall.get("known_risks", []) or []
            if isinstance(item, str) and item.strip()
        ]

    return {
        "approved": approved,
        "risk_level": risk_level,
        "issues": issues,
        "required_fixes": required_fixes,
        "checks": checks,
        "summary": summary,
        "skill_id": matched_skill.get("id"),
        "skill_name": matched_skill.get("name"),
        "risk_rules": risk_rules,
        "acceptance_template": acceptance_template,
        "historical_risks": historical_risks,
        "validation_result": validation_result if isinstance(validation_result, dict) else None,
    }


def _normalize_path(path: str) -> str:
    return str(path or "").replace("\\", "/").lower().strip("/")


def _is_code_patch(patch: Dict[str, Any]) -> bool:
    return isinstance(patch, dict) and ("diff" in patch or "before_snippet" in patch or "after_snippet" in patch)


def _contains_todo_patch(patch: Dict[str, Any]) -> bool:
    text = " ".join(
        str(patch.get(key) or "")
        for key in ("before_snippet", "after_snippet", "diff", "content")
    )
    return "todo" in text.lower() or "implement requested change" in text.lower()


def _requires_real_before_snippet(located_files: Optional[Dict[str, Any]], matched_skill: Optional[Dict[str, Any]]) -> bool:
    if isinstance(matched_skill, dict) and matched_skill.get("id") == "cover-image":
        return True
    if isinstance(located_files, dict):
        return located_files.get("strategy") in {"real_repo", "conduit_repo"}
    return False


def _is_unrelated_cover_image_patch_file(file_path: str) -> bool:
    normalized = _normalize_path(file_path)
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
    return any(token in normalized for token in unrelated_tokens)


def _cover_image_invalid_js_issue(patch: Dict[str, Any]) -> Optional[str]:
    after_text = str(patch.get("after_snippet") or "")
    text = "\n".join(str(patch.get(key) or "") for key in ("after_snippet", "diff"))
    if re.search(r"\bcoverImage\s*:\s*\{\s*type\s*:\s*String\s*\}", text):
        return "Invalid Sequelize coverImage field type; use DataTypes.STRING"
    if _has_const_inside_use_state_args(after_text or text):
        return "Invalid editor_form patch: const declaration appears inside useState arguments"
    lines = text.splitlines()
    previous = ""
    for line in lines:
        stripped = line.strip().lstrip("+").strip()
        if re.match(r"^coverImage\s*:\s*[^;]+,?\s*$", stripped):
            if previous.endswith(("};", "});")) or re.match(r"^(?:const|let|var)\s+\w+\s*=.*;\s*$", previous):
                return "Invalid editor_form patch: coverImage property appears outside an object literal"
        if stripped:
            previous = stripped
    return None


def _has_const_inside_use_state_args(source: str) -> bool:
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
            return True
    return False


def _paths_match(patch_path: str, located_path: str) -> bool:
    patch_normalized = _normalize_path(patch_path)
    located_normalized = _normalize_path(located_path)
    return (
        bool(patch_normalized)
        and bool(located_normalized)
        and (
            patch_normalized == located_normalized
            or patch_normalized.endswith(located_normalized)
            or located_normalized.endswith(patch_normalized)
        )
    )


def _extract_located_paths(located_files: Optional[Dict[str, Any]]) -> List[str]:
    if not isinstance(located_files, dict) or not located_files.get("located"):
        return []

    paths: List[str] = []
    for item in located_files.get("files", []) or []:
        if not isinstance(item, dict):
            continue
        for key in ("relative_path", "path"):
            value = item.get(key)
            if isinstance(value, str) and value.strip() and value not in paths:
                paths.append(value)
    return paths


def _located_article_editor_form_path(paths: List[str]) -> Optional[str]:
    for path in paths:
        normalized = _normalize_path(path)
        if normalized.endswith("frontend/src/components/articleeditorform/articleeditorform.jsx"):
            return path
    return None


def _acceptance_keywords(acceptance_template: List[str]) -> List[str]:
    keywords: List[str] = []
    for item in acceptance_template or []:
        if not isinstance(item, str):
            continue
        lowered = item.lower()
        for token in ("word count", "reading time", "about me", "tab", "cover image", "bio", "cover", "image"):
            if token in lowered and token not in keywords:
                keywords.append(token)
    return keywords
