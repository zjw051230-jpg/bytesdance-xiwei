import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "agent_core"))

from orchestrator.state import AgentState
from tools.tool_registry import execute


class FinishSummaryTest(unittest.TestCase):
    def test_finish_generates_final_summary(self):
        state = AgentState(task_id="finish_summary_test", user_input="文章详情页新增字数统计")
        state.matched_skill = {"name": "article-word-stats"}
        state.artifacts["plan"] = {"task_name": "Add article word count and reading time"}
        state.artifacts["located_files"] = {"files": [1, 2]}
        state.artifacts["patch_plan"] = {"patches": [{"file": "a"}]}
        state.artifacts["review"] = {"approved": True}
        state.artifacts["execution_result"] = {"executed": True}
        state.model_trace = [{"step": 0}]

        result = execute({"tool": "finish"}, state)

        final_summary = result["result"]["final_summary"]
        self.assertEqual(final_summary["status"], "SUCCESS")
        self.assertEqual(final_summary["skill"]["name"], "article-word-stats")
        self.assertEqual(final_summary["patch_count"], 1)
        self.assertTrue(final_summary["review_approved"])
        self.assertTrue(final_summary["execution_executed"])
        self.assertGreaterEqual(final_summary["model_calls"], 1)
        self.assertEqual(state.artifacts["final_summary"]["status"], "SUCCESS")


if __name__ == "__main__":
    unittest.main()
