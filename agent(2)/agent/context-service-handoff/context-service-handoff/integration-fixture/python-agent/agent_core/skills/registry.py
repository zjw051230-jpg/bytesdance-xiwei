import json
from pathlib import Path
from typing import Any, Dict, List


def load_skills() -> List[Dict[str, Any]]:
    skills_dir = Path(__file__).resolve().parent
    skills: List[Dict[str, Any]] = []

    for path in sorted(skills_dir.glob("*.json")):
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            skills.append(data)

    return skills


def match_skill(requirement: str) -> Dict[str, Any]:
    text = (requirement or "").lower()
    best_skill = None
    best_score = 0

    for skill in load_skills():
        score = 0
        keywords = skill.get("keywords", []) or []
        for keyword in keywords:
            if isinstance(keyword, str) and keyword.lower() in text:
                score += 1

        if score > best_score:
            best_score = score
            best_skill = skill

    if best_skill is None or best_score <= 0:
        return {"matched": False, "skill": None, "score": 0}

    return {"matched": True, "skill": best_skill, "score": best_score}
