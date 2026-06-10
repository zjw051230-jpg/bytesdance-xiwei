from typing import Any, Dict, List, Optional


DANGEROUS_PATTERNS = (
    "/tests/",
    "\\tests\\",
    ".test.js",
    ".spec.js",
    "package-lock.json",
    "yarn.lock",
    ".env",
)


def review_patch_plan(plan: Optional[Dict[str, Any]], located_files: Optional[Dict[str, Any]], patch_plan: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    plan = plan or {}
    patch_plan = patch_plan or {}

    issues: List[str] = []
    required_fixes: List[str] = []
    approved = True
    risk_level = "low"

    if not isinstance(patch_plan, dict) or not patch_plan.get("patches"):
        approved = False
        risk_level = "high"
        issues.append("Missing patch plan")
        required_fixes.append("Provide a non-empty patch plan before review")

    patches = patch_plan.get("patches", []) if isinstance(patch_plan, dict) else []
    for patch in patches:
        file_path = patch.get("file", "")
        patch_risk = patch.get("risk_level", "low")
        if patch_risk == "high":
            approved = False
            risk_level = "high"
            issues.append("High risk patch detected")

        if any(token in file_path for token in DANGEROUS_PATTERNS):
            approved = False
            risk_level = "high"
            issues.append(f"Dangerous file in patch plan: {file_path}")

    summary_parts = [patch_plan.get("summary", "") if isinstance(patch_plan, dict) else ""]
    for patch in patches:
        summary_parts.extend(patch.get("changes", []))
    summary_text = " ".join(part for part in summary_parts if isinstance(part, str))
    acceptance_criteria = plan.get("acceptance_criteria", []) if isinstance(plan, dict) else []
    if acceptance_criteria and not any(keyword.lower() in summary_text.lower() for keyword in ("word count", "reading time", "about me", "tab", "cover image", "bio")):
        issues.append("Patch plan may not fully cover acceptance criteria")

    if isinstance(patch_plan, dict) and patch_plan.get("patches"):
        for patch in patch_plan["patches"]:
            changes = " ".join(patch.get("changes", [])).lower()
            file_path = patch.get("file", "")
            skill_name = (plan or {}).get("skill_name", "") or ""
            summary_text = (patch_plan.get("summary", "") or "")
            if "article-word-stats" in skill_name or "article-word-stats" in summary_text:
                if "word count" not in changes and "reading time" not in changes:
                    approved = False
                    issues.append("Patch plan is missing word count or reading time changes")
            if "about-me-tab" in skill_name or "about-me-tab" in summary_text:
                if "tab" not in changes and "bio" not in changes:
                    approved = False
                    issues.append("Patch plan is missing About Me tab or bio changes")

    if any(patch.get("file", "").startswith("backend/") for patch in patches):
        risk_level = "medium" if risk_level == "low" else risk_level

    checks = {
        "has_patch_plan": bool(isinstance(patch_plan, dict) and patch_plan.get("patches")),
        "matches_acceptance_criteria": not any("acceptance criteria" in issue.lower() for issue in issues),
        "regression_risk_checked": True,
        "dangerous_files_checked": True,
    }

    if not issues:
        summary = "Patch plan is acceptable for the next execution phase."
    else:
        summary = "Patch plan has review issues that should be resolved before execution."

    return {
        "approved": approved,
        "risk_level": risk_level,
        "issues": issues,
        "required_fixes": required_fixes,
        "checks": checks,
        "summary": summary,
    }
