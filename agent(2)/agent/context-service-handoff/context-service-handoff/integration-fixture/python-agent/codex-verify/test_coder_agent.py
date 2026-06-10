import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "agent_core"))

from agents.coder_agent import generate_patch_plan


class CoderAgentTest(unittest.TestCase):
    def test_generate_patch_plan_for_article_word_stats(self):
        patch_plan = generate_patch_plan("文章详情页新增字数统计", {"name": "article-word-stats"}, None, None)

        self.assertIn("frontend/src/pages/Article.jsx", [item["file"] for item in patch_plan["patches"]])
        self.assertTrue(any("word count" in change.lower() for change in patch_plan["patches"][0]["changes"]))
        self.assertTrue(any("reading time" in change.lower() for change in patch_plan["patches"][0]["changes"]))

    def test_generate_patch_plan_for_about_me_tab(self):
        patch_plan = generate_patch_plan("个人主页新增About Me Tab", {"name": "about-me-tab"}, None, None)

        self.assertIn("Profile.jsx", patch_plan["patches"][0]["file"])

    def test_generate_patch_plan_for_cover_image(self):
        patch_plan = generate_patch_plan("给文章增加封面图", {"name": "cover-image"}, None, None)

        files = [item["file"] for item in patch_plan["patches"]]
        self.assertIn("backend/src/models/Article.js", files)
        self.assertIn("frontend/src/pages/Editor.jsx", files)


if __name__ == "__main__":
    unittest.main()
