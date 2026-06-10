from typing import Any, Dict, List, Optional


def locate_files(plan: Optional[Dict[str, Any]], matched_skill: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    target_files = None
    if isinstance(plan, dict):
        target_files = plan.get("target_files_hint") or []

    if isinstance(target_files, list) and target_files:
        files = [
            {
                "path": item,
                "reason": "File candidate from plan target_files_hint",
                "confidence": 0.75,
            }
            for item in target_files
            if isinstance(item, str) and item.strip()
        ]
        return {"located": True, "files": files, "strategy": "plan_hint"}

    skill_name = None
    if isinstance(matched_skill, dict):
        skill_name = matched_skill.get("name")

    if skill_name == "article-word-stats":
        return {
            "located": True,
            "files": [
                {"path": "frontend/src/pages/Article.jsx", "reason": "Default article detail page file", "confidence": 0.8},
                {"path": "frontend/src/components", "reason": "Default article UI components folder", "confidence": 0.6},
            ],
            "strategy": "skill_default",
        }

    if skill_name == "about-me-tab":
        return {
            "located": True,
            "files": [
                {"path": "frontend/src/pages/Profile.jsx", "reason": "Default profile page file", "confidence": 0.8},
                {"path": "frontend/src/components", "reason": "Default profile UI components folder", "confidence": 0.6},
            ],
            "strategy": "skill_default",
        }

    if skill_name == "cover-image":
        return {
            "located": True,
            "files": [
                {"path": "backend/src/models/Article.js", "reason": "Default article model file", "confidence": 0.85},
                {"path": "backend/src/routes/articles.js", "reason": "Default article route file", "confidence": 0.8},
                {"path": "frontend/src/pages/Editor.jsx", "reason": "Default editor page file", "confidence": 0.75},
                {"path": "frontend/src/pages/Article.jsx", "reason": "Default article page file", "confidence": 0.75},
            ],
            "strategy": "skill_default",
        }

    return {"located": False, "files": [], "strategy": "fallback"}
