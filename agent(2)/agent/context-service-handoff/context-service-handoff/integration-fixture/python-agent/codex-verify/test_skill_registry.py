import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "agent_core"))

from skills.registry import load_skills, match_skill


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
        result = match_skill("个人主页新增About Me Tab")

        self.assertTrue(result["matched"])
        self.assertEqual(result["skill"]["name"], "about-me-tab")

    def test_match_skill_returns_cover_image(self):
        result = match_skill("给文章增加封面图")

        self.assertTrue(result["matched"])
        self.assertEqual(result["skill"]["name"], "cover-image")


if __name__ == "__main__":
    unittest.main()
