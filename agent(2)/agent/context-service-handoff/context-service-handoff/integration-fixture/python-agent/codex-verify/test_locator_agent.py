import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "agent_core"))

from agents.locator_agent import locate_files


class LocatorAgentTest(unittest.TestCase):
    def test_locate_files_uses_plan_hint(self):
        result = locate_files({"target_files_hint": ["frontend/src/pages/Article.jsx"]}, {"name": "article-word-stats"})

        self.assertTrue(result["located"])
        self.assertEqual(result["strategy"], "plan_hint")
        self.assertTrue(any(item["path"] == "frontend/src/pages/Article.jsx" for item in result["files"]))

    def test_locate_files_defaults_for_about_me_tab(self):
        result = locate_files(None, {"name": "about-me-tab"})

        self.assertTrue(result["located"])
        self.assertTrue(any("Profile.jsx" in item["path"] for item in result["files"]))

    def test_locate_files_defaults_for_cover_image(self):
        result = locate_files(None, {"name": "cover-image"})

        self.assertTrue(result["located"])
        self.assertTrue(any("backend/src/models/Article.js" in item["path"] for item in result["files"]))
        self.assertTrue(any("frontend/src/pages/Editor.jsx" in item["path"] for item in result["files"]))


if __name__ == "__main__":
    unittest.main()
