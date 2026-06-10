import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "agent_core"))

from agents.reviewer_agent import review_patch_plan


class ReviewerAgentTest(unittest.TestCase):
    def test_review_patch_plan_accepts_article_word_stats(self):
        review = review_patch_plan(
            {"acceptance_criteria": ["shows word count", "shows reading time"]},
            None,
            {
                "summary": "Prepare article word count and reading time display",
                "patches": [
                    {"file": "frontend/src/pages/Article.jsx", "changes": ["Add word count calculation", "Add reading time calculation"], "risk_level": "low"}
                ],
            },
        )

        self.assertTrue(review["approved"])
        self.assertEqual(review["risk_level"], "low")

    def test_review_patch_plan_rejects_dangerous_file(self):
        review = review_patch_plan(
            None,
            None,
            {"patches": [{"file": "frontend/src/pages/Article.test.js", "changes": ["unsafe"], "risk_level": "high"}]},
        )

        self.assertFalse(review["approved"])
        self.assertIn("Dangerous file in patch plan: frontend/src/pages/Article.test.js", review["issues"])


if __name__ == "__main__":
    unittest.main()
