import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "agent_core"))

from agents.planner_agent import create_plan


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


if __name__ == "__main__":
    unittest.main()
