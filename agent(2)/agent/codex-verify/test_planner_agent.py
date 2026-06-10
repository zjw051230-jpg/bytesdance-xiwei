import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "agent_core"))

from agents.planner_agent import create_plan
from skills.registry import match_skill


class FakeLLMAdapter:
    def __init__(self, text, ok=True):
        self.text = text
        self.ok = ok

    def generate(self, prompt: str, system_prompt=None, temperature: float = 0.2):
        return {
            "ok": self.ok,
            "provider": "fake",
            "model": "fake-model",
            "text": self.text,
            "error": None if self.ok else "fake failure",
        }


class PlannerAgentTest(unittest.TestCase):
    def test_create_plan_for_article_word_stats(self):
        plan = create_plan("文章详情页新增字数统计", {"name": "article-word-stats"})

        self.assertEqual(plan["skill_name"], "article-word-stats")
        self.assertEqual(plan["scope"], "frontend")
        self.assertIn("Article.jsx", plan["target_files_hint"])
        self.assertTrue(any("不破坏原文章渲染" in item for item in plan["acceptance_criteria"]))

    def test_create_plan_for_about_me_tab(self):
        plan = create_plan("个人主页新增About Me Tab", {"name": "about-me-tab"})

        self.assertEqual(plan["skill_name"], "about-me-tab")

    def test_create_plan_for_cover_image(self):
        plan = create_plan("给文章增加封面图", {"name": "cover-image"})

        self.assertEqual(plan["skill_name"], "cover-image")
        self.assertEqual(plan["scope"], "fullstack")

    def test_create_plan_uses_llm_when_enabled_and_json_valid(self):
        llm = FakeLLMAdapter(
            '{"plan":"Create note file","intent":"write note","risk_level":"low","suggested_files":["note.txt"],"test_commands":["python -m unittest discover -s tests -v"]}'
        )

        with patch.dict("os.environ", {"AGENT_USE_LLM_PLANNER": "1"}, clear=True):
            plan = create_plan("创建 note.txt 文件，内容为 100", None, llm_adapter=llm)

        self.assertEqual(plan["task_name"], "Create note file")
        self.assertEqual(plan["intent"], "write note")
        self.assertEqual(plan["risk_level"], "low")
        self.assertEqual(plan["target_files_hint"], ["note.txt"])
        self.assertEqual(plan["metadata"]["planner"], "llm")

    def test_create_plan_falls_back_when_llm_json_invalid(self):
        llm = FakeLLMAdapter("not json")

        with patch.dict("os.environ", {"AGENT_USE_LLM_PLANNER": "1"}, clear=True):
            plan = create_plan("unknown task", None, llm_adapter=llm)

        self.assertEqual(plan["task_name"], "Generate implementation plan")
        self.assertIn("llm_planner_fallback_reason", plan["metadata"])

    def test_create_plan_uses_requirement_dsl_without_guessing_requirement(self):
        dsl = {
            "requirement_id": "REQ-101",
            "task_name": "Add billing export",
            "user_story": "As an operator I can export billing data",
            "requirement_type": "backend",
            "target_modules": ["backend/src/billing/export.py"],
            "acceptance_criteria": ["CSV export is available"],
            "constraints": ["Do not change auth policy"],
            "skill_hint": "billing-export",
            "test_commands": ["python -m unittest discover -s codex-verify -v"],
            "risk_level": "medium",
        }

        plan = create_plan("ignored natural language", None, requirement_dsl=dsl)

        self.assertEqual(plan["requirement_id"], "REQ-101")
        self.assertEqual(plan["task_name"], "Add billing export")
        self.assertEqual(plan["requirement_type"], "backend")
        self.assertEqual(plan["target_modules"], ["backend/src/billing/export.py"])
        self.assertEqual(plan["acceptance_criteria"], ["CSV export is available"])
        self.assertEqual(plan["constraints"], ["Do not change auth policy"])
        self.assertEqual(plan["test_commands"], ["python -m unittest discover -s codex-verify -v"])
        self.assertEqual(plan["metadata"]["planner"], "requirement_dsl")

    def test_create_plan_with_dsl_none_skill_and_conduit_repo_does_not_crash(self):
        dsl = {
            "requirement_id": "REQ-CONDUIT-L1-ARTICLE-STATS",
            "task_name": "Add article word count and reading time",
            "user_story": "As a reader, I can see word count and estimated reading time.",
            "requirement_type": "conduit_frontend_l1",
            "target_modules": ["frontend/src/pages/Article.jsx"],
            "acceptance_criteria": ["Article detail page shows word count."],
            "skill_hint": "article-word-stats",
            "test_commands": ["npm run lint"],
            "risk_level": "low",
        }
        repo_profile = {"repo_type": "conduit", "available_scripts": {"frontend": {"lint": "vite lint"}}}

        plan = create_plan("ignored natural language", None, requirement_dsl=dsl, repo_profile=repo_profile)

        self.assertEqual(plan["requirement_id"], "REQ-CONDUIT-L1-ARTICLE-STATS")
        self.assertEqual(plan["skill_name"], "article-word-stats")
        self.assertEqual(plan["metadata"]["conduit_scope"], "frontend")
        self.assertIn("Article detail page shows word count.", plan["acceptance_criteria"])

    def test_matched_skill_fields_enter_plan(self):
        matched = match_skill("please add reading time to article page")["skill"]

        plan = create_plan("please add reading time to article page", matched)

        self.assertEqual(plan["skill_id"], "article-word-stats")
        self.assertIn("frontend/src/pages/Article.jsx", plan["target_modules"])
        self.assertIn("Article detail page shows word count", plan["acceptance_template"])
        self.assertEqual(plan["test_commands"], ["npm run lint"])


if __name__ == "__main__":
    unittest.main()
