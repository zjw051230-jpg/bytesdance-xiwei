from typing import Any, Dict, Optional


def generate_patch_plan(user_input: str, matched_skill: Optional[Dict[str, Any]], plan: Optional[Dict[str, Any]], located_files: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    skill_name = None
    if isinstance(matched_skill, dict):
        skill_name = matched_skill.get("name")

    if skill_name == "article-word-stats":
        return {
            "patches": [
                {
                    "file": "frontend/src/pages/Article.jsx",
                    "reason": "Article detail page needs word count and reading time display",
                    "changes": [
                        "Add word count calculation",
                        "Add reading time calculation",
                        "Render stats below article content",
                    ],
                    "risk_level": "low",
                }
            ],
            "summary": "Prepare a low-risk frontend patch for article stats display.",
        }

    if skill_name == "about-me-tab":
        return {
            "patches": [
                {
                    "file": "frontend/src/pages/Profile.jsx",
                    "reason": "Profile page needs a dedicated About Me tab and bio section",
                    "changes": [
                        "Add About Me tab",
                        "Add tab navigation entry",
                        "Render user bio section",
                    ],
                    "risk_level": "low",
                }
            ],
            "summary": "Prepare a low-risk frontend patch for the profile tab experience.",
        }

    if skill_name == "cover-image":
        return {
            "patches": [
                {
                    "file": "backend/src/models/Article.js",
                    "reason": "Article model should store cover image metadata",
                    "changes": ["Add cover image field"],
                    "risk_level": "medium",
                },
                {
                    "file": "frontend/src/pages/Editor.jsx",
                    "reason": "Article editor should accept cover image input",
                    "changes": ["Add cover image upload field"],
                    "risk_level": "medium",
                },
            ],
            "summary": "Prepare a medium-risk fullstack patch for article cover image support.",
        }

    return {
        "patches": [
            {
                "file": "frontend/src/pages/Article.jsx",
                "reason": "Generic patch plan placeholder based on the current requirement",
                "changes": ["Clarify implementation scope", "Locate relevant modules", "Prepare targeted changes"],
                "risk_level": "low",
            }
        ],
        "summary": "Prepare a generic patch plan for the current requirement.",
    }
