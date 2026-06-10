import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "agent_core"))

from skills.registry import load_skills, match_skill
from interfaces.event_adapter import MockEventAdapter
from interfaces.memory_adapter import InMemoryMemoryAdapter
from orchestrator.state import AgentState
from tools.tool_registry import execute


class SkillRegistryTest(unittest.TestCase):
    def test_load_skills_returns_all_json_skills(self):
        skills = load_skills()

        self.assertGreaterEqual(len(skills), 3)
        self.assertTrue(any(skill["name"] == "article-word-stats" for skill in skills))

    def test_match_skill_returns_article_word_stats(self):
        result = match_skill("文章详情页新增字数统计")

        self.assertTrue(result["matched"])
        self.assertEqual(result["skill"]["name"], "article-word-stats")
        self.assertGreater(result["score"], 0)

    def test_match_skill_returns_about_me_tab(self):
        result = match_skill("个人主页新增 About Me Tab")

        self.assertTrue(result["matched"])
        self.assertEqual(result["skill"]["name"], "about-me-tab")

    def test_match_skill_returns_cover_image(self):
        result = match_skill("给文章增加封面图")

        self.assertTrue(result["matched"])
        self.assertEqual(result["skill"]["name"], "cover-image")

    def test_match_skill_uses_skill_hint_exact_match(self):
        result = match_skill(
            "some generic text",
            requirement_dsl={"skill_hint": "cover-image", "task_name": "Add media", "requirement_type": "frontend"},
        )

        self.assertTrue(result["matched"])
        self.assertEqual(result["skill"]["id"], "cover-image")
        self.assertIn("skill_hint", result["match_reason"])

    def test_match_skill_uses_requirement_type(self):
        result = match_skill(
            "media upload",
            requirement_dsl={"task_name": "Add image", "requirement_type": "media"},
        )

        self.assertTrue(result["matched"])
        self.assertEqual(result["skill"]["id"], "cover-image")
        self.assertIn("requirement_type", result["match_reason"])

    def test_match_skill_uses_keyword(self):
        result = match_skill("please add reading time to article page")

        self.assertTrue(result["matched"])
        self.assertEqual(result["skill"]["id"], "article-word-stats")
        self.assertIn("keywords", result["match_reason"])

    def test_match_skill_falls_back_to_generic(self):
        result = match_skill("unrelated operation with no known pattern")

        self.assertFalse(result["matched"])
        self.assertEqual(result["skill"]["id"], "generic")
        self.assertEqual(result["match_reason"], "generic_fallback")

    def test_conduit_theme_requires_theme_signal(self):
        result = match_skill(
            "add remember account and password checkbox to the login page",
            requirement_dsl={
                "requirement_type": "conduit_l1_frontend",
                "task_name": "记住账号密码",
                "user_story": "用户手动勾选后才保存账号密码，默认关闭",
                "target_modules": ["frontend/src"],
                "acceptance_criteria": ["After user turns on dark mode, all pages display black background."],
            },
        )

        self.assertEqual(result["skill"]["id"], "conduit-login-auth")

    def test_conduit_theme_matches_direct_theme_request(self):
        result = match_skill(
            "change the Conduit home page to a black red theme",
            requirement_dsl={"requirement_type": "conduit_l1_frontend", "target_modules": ["frontend/src"]},
        )

        self.assertTrue(result["matched"])
        self.assertEqual(result["skill"]["id"], "conduit-theme")

    def test_execute_select_skill_records_state_event_memory_and_context(self):
        memory = InMemoryMemoryAdapter()
        events = MockEventAdapter()
        state = AgentState(task_id="skill_match_test", user_input="please add reading time to article page")

        with patch("tools.tool_registry.get_default_memory_adapter", return_value=memory), \
             patch("tools.tool_registry.get_default_event_adapter", return_value=events):
            observation = execute({"tool": "select_skill", "args": {}}, state)

        self.assertTrue(observation["ok"])
        self.assertEqual(state.artifacts["matched_skill"]["id"], "article-word-stats")
        self.assertEqual(state.artifacts["skill_match"]["match_reason"], "keywords")
        self.assertEqual(memory.events[0]["stage"], "select_skill")
        self.assertEqual(state.artifacts["last_event"]["type"], "SKILL_MATCHED")
        self.assertEqual(state.context_snapshots[0]["agent_name"], "plannerAgent")


if __name__ == "__main__":
    unittest.main()
