from typing import Any, Dict, List, Optional


def _generic_plan(user_input: str, runtime_instructions: Optional[List[str]] = None) -> Dict[str, Any]:
    return {
        "task_name": "Generate implementation plan",
        "skill_name": None,
        "scope": "unknown",
        "steps": ["Clarify requirement", "Locate relevant modules", "Propose implementation plan"],
        "target_files_hint": [],
        "acceptance_criteria": ["Requirement needs clarification"],
        "test_commands": [],
        "runtime_instructions": list(runtime_instructions or []),
    }


def create_plan(user_input: str, matched_skill: Optional[Dict[str, Any]], runtime_instructions: Optional[List[str]] = None) -> Dict[str, Any]:
    skill_name = None
    if isinstance(matched_skill, dict):
        skill_name = matched_skill.get("name")

    if skill_name == "article-word-stats":
        return {
            "task_name": "Add article word count and reading time",
            "skill_name": "article-word-stats",
            "scope": "frontend",
            "steps": [
                "Locate article detail page",
                "Read article body field",
                "Add word count and reading time calculation",
                "Render stats below article content",
                "Run lint/test",
            ],
            "target_files_hint": ["frontend/src/pages/Article.jsx", "Article.jsx", "frontend/src/components"],
            "acceptance_criteria": [
                "Article detail page shows word count",
                "Article detail page shows estimated reading time",
                "Existing article rendering is not broken",
                "不破坏原文章渲染",
            ],
            "test_commands": ["npm run lint"],
            "runtime_instructions": list(runtime_instructions or []),
        }

    if skill_name == "about-me-tab":
        return {
            "task_name": "Add About Me tab to profile page",
            "skill_name": "about-me-tab",
            "scope": "frontend",
            "steps": [
                "Locate profile page and tab navigation",
                "Add About Me tab entry",
                "Render profile summary content",
                "Verify page layout and navigation",
            ],
            "target_files_hint": ["frontend/src/pages/Profile.jsx", "frontend/src/components/Tabs.jsx"],
            "acceptance_criteria": ["Profile page shows About Me tab", "Tab content renders correctly"],
            "test_commands": ["npm run lint"],
            "runtime_instructions": list(runtime_instructions or []),
        }

    if skill_name == "cover-image":
        return {
            "task_name": "Add article cover image support",
            "skill_name": "cover-image",
            "scope": "fullstack",
            "steps": [
                "Inspect article model and API schema",
                "Add cover image field to backend data flow",
                "Update article form to upload or select cover image",
                "Render cover image on article page",
                "Run backend/frontend tests",
            ],
            "target_files_hint": ["backend/models/Article.py", "backend/api/articles.py", "frontend/src/pages/Article.jsx"],
            "acceptance_criteria": ["Article can store a cover image", "Article page displays cover image"],
            "test_commands": ["npm run lint", "pytest -q"],
            "runtime_instructions": list(runtime_instructions or []),
        }

    return _generic_plan(user_input, runtime_instructions)
