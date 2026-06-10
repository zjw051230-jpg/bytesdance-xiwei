import json
from pathlib import Path
from typing import Any, Dict, List, Optional


GENERIC_SKILL = {
    "id": "generic",
    "name": "generic",
    "description": "Generic implementation skill for unmatched requirements",
    "requirement_types": ["feature", "backend", "frontend", "fullstack", "dsl", "unknown"],
    "keywords": [],
    "target_modules": [],
    "target_file_patterns": [],
    "context_rules": ["Use Requirement DSL fields and located files as primary context"],
    "patch_strategy": {
        "summary": "Prepare a generic patch plan for the current requirement.",
        "patches": [
            {
                "file": "frontend/src/pages/Article.jsx",
                "reason": "Generic patch plan placeholder based on the current requirement",
                "changes": ["Clarify implementation scope", "Locate relevant modules", "Prepare targeted changes"],
                "risk_level": "low",
            }
        ],
    },
    "acceptance_template": ["Requirement needs clarification"],
    "default_test_commands": [],
    "risk_rules": {"default": "low", "backend": "medium"},
}


def _requirement_candidates(requirement: str) -> List[str]:
    text = requirement or ""
    candidates = [text]

    # Windows PowerShell can pass UTF-8 bytes that Python decodes as the active
    # ANSI code page. Try the common Chinese code pages so piped input behaves
    # like interactive input.
    for encoding in ("gbk", "cp936"):
        try:
            repaired = text.encode(encoding).decode("utf-8")
        except UnicodeError:
            continue
        if repaired and repaired not in candidates:
            candidates.append(repaired)

    return candidates


def _skills_dir() -> Path:
    return Path(__file__).resolve().parent


def _definition_paths() -> List[Path]:
    definitions_dir = _skills_dir() / "definitions"
    if definitions_dir.exists():
        return sorted(definitions_dir.glob("*.json"))
    return sorted(_skills_dir().glob("*.json"))


def _normalize_skill(data: Dict[str, Any], source: str = "") -> Dict[str, Any]:
    skill = dict(data)
    skill.setdefault("id", skill.get("name") or "unknown")
    skill.setdefault("name", skill.get("id"))
    skill.setdefault("description", "")
    skill.setdefault("requirement_types", [])
    skill.setdefault("keywords", [])
    skill.setdefault("target_modules", [])
    skill.setdefault("target_file_patterns", skill.get("target_modules", []))
    skill.setdefault("context_rules", [])
    skill.setdefault("patch_strategy", {})
    skill.setdefault("acceptance_template", [])
    skill.setdefault("default_test_commands", [])
    skill.setdefault("conduit_frontend_patterns", [])
    skill.setdefault("conduit_backend_patterns", [])
    skill.setdefault("conduit_test_commands", [])
    skill.setdefault("conduit_acceptance_checks", [])
    skill.setdefault("risk_rules", {"default": "low"})
    if source:
        skill.setdefault("source", source)
    return skill


def load_skills() -> List[Dict[str, Any]]:
    skills: List[Dict[str, Any]] = []
    for path in _definition_paths():
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            skills.append(_normalize_skill(data, str(path)))
    return skills


def get_generic_skill() -> Dict[str, Any]:
    return _normalize_skill(GENERIC_SKILL)


def get_skill_by_id(skill_id: str) -> Optional[Dict[str, Any]]:
    normalized = str(skill_id or "").lower()
    if not normalized:
        return None
    for skill in load_skills():
        if normalized in {str(skill.get("id", "")).lower(), str(skill.get("name", "")).lower()}:
            return skill
    if normalized == "generic":
        return get_generic_skill()
    return None


def resolve_skill(skill: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not isinstance(skill, dict):
        return skill
    if skill.get("patch_strategy") or skill.get("target_file_patterns") or skill.get("acceptance_template"):
        return skill
    resolved = get_skill_by_id(skill.get("id") or skill.get("name"))
    return resolved or skill


def _dsl_text(requirement_dsl: Optional[Dict[str, Any]]) -> str:
    if not isinstance(requirement_dsl, dict):
        return ""
    parts = [
        requirement_dsl.get("task_name"),
        requirement_dsl.get("user_story"),
        requirement_dsl.get("requirement_type"),
        requirement_dsl.get("skill_hint"),
    ]
    parts.extend(requirement_dsl.get("target_modules") or [])
    parts.extend(requirement_dsl.get("acceptance_criteria") or [])
    parts.extend(requirement_dsl.get("constraints") or [])
    return " ".join(str(part) for part in parts if part)


def _matches_hint(skill: Dict[str, Any], hint: str) -> bool:
    normalized_hint = (hint or "").lower().strip()
    return normalized_hint in {
        str(skill.get("id", "")).lower(),
        str(skill.get("name", "")).lower(),
    }


def _score_skill(skill: Dict[str, Any], requirement: str, requirement_dsl: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    score = 0
    reasons: List[str] = []
    dsl = requirement_dsl if isinstance(requirement_dsl, dict) else {}

    if dsl.get("skill_hint") and _matches_hint(skill, dsl.get("skill_hint")):
        score += 100
        reasons.append("skill_hint")

    requirement_type = str(dsl.get("requirement_type") or "").lower()
    if requirement_type and requirement_type in {str(item).lower() for item in skill.get("requirement_types", []) or []}:
        score += 20
        reasons.append("requirement_type")

    target_modules = [str(item).lower() for item in dsl.get("target_modules", []) or []]
    for pattern in skill.get("target_modules", []) or []:
        lowered_pattern = str(pattern).lower()
        if any(lowered_pattern in module or module in lowered_pattern for module in target_modules):
            score += 12
            reasons.append("target_modules")
            break

    texts = _requirement_candidates(requirement)
    dsl_combined = _dsl_text(dsl)
    if dsl_combined:
        texts.extend(_requirement_candidates(dsl_combined))

    for text in texts:
        lowered_text = text.lower()
        for keyword in skill.get("keywords", []) or []:
            if isinstance(keyword, str) and keyword.lower() in lowered_text:
                score += 5
                if "keywords" not in reasons:
                    reasons.append("keywords")

    return {"score": score, "reasons": reasons}


def match_skill(requirement: str, requirement_dsl: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    best_skill = None
    best_score = -1
    best_reasons: List[str] = []

    for skill in load_skills():
        scored = _score_skill(skill, requirement, requirement_dsl)
        if scored["score"] > best_score:
            best_score = scored["score"]
            best_skill = skill
            best_reasons = scored["reasons"]

    if best_skill is None or best_score <= 0:
        return {
            "matched": False,
            "skill": get_generic_skill(),
            "score": 0,
            "match_reason": "generic_fallback",
        }

    return {
        "matched": True,
        "skill": best_skill,
        "score": best_score,
        "match_reason": "+".join(best_reasons) if best_reasons else "unknown",
    }
