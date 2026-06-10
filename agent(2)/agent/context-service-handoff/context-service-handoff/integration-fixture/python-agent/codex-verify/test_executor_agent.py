import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "agent_core"))

from agents.executor_agent import execute_patch_plan


class ExecutorAgentTest(unittest.TestCase):
    def test_execute_patch_plan_runs_for_approved_patch(self):
        result = execute_patch_plan(
            {"patches": [{"file": "frontend/src/pages/Article.jsx", "changes": ["Add word count"]}]},
            {"approved": True},
        )

        self.assertTrue(result["executed"])
        self.assertEqual(result["mode"], "dry_run")
        self.assertTrue(result["files"])

    def test_execute_patch_plan_blocks_when_review_not_approved(self):
        result = execute_patch_plan(
            {"patches": [{"file": "frontend/src/pages/Article.jsx", "changes": ["Add word count"]}]},
            {"approved": False},
        )

        self.assertFalse(result["executed"])
        self.assertIn("blocked", result["summary"].lower())


if __name__ == "__main__":
    unittest.main()
