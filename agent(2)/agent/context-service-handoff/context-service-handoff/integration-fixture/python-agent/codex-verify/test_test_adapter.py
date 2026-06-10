import sys
import unittest
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "agent_core"))

from agents.verifier_agent import verify_execution
from interfaces.test_adapter import MockTestAdapter, RealTestAdapter, get_default_test_adapter
from orchestrator.agent_loop import run_agent


class TestAdapterTest(unittest.TestCase):
    def test_mock_test_adapter_passes_commands(self):
        result = MockTestAdapter().run_tests(["npm run lint", "npm test"])

        self.assertTrue(result["ok"])
        self.assertTrue(result["passed"])
        self.assertEqual(len(result["commands"]), 2)
        self.assertEqual(result["commands"][0]["status"], "passed")

    def test_verify_execution_uses_default_lint_when_plan_has_no_commands(self):
        result = verify_execution(
            plan={},
            execution_result={"executed": True},
            test_adapter=MockTestAdapter(),
        )

        self.assertTrue(result["verified"])
        self.assertTrue(result["passed"])
        self.assertEqual(result["mode"], "mock_test")
        self.assertEqual(result["test_result"]["commands"][0]["command"], "npm run lint")

    def test_full_agent_flow_stores_verification_result_and_summary(self):
        state = run_agent("文章详情页新增字数统计", task_id="verify_result_flow_test")

        verification_result = state.artifacts["verification_result"]
        final_summary = state.artifacts["final_summary"]

        self.assertTrue(verification_result["verified"])
        self.assertTrue(verification_result["passed"])
        self.assertEqual(verification_result["mode"], "mock_test")
        self.assertTrue(final_summary["verification_passed"])

    def test_default_test_adapter_is_singleton(self):
        self.assertIs(get_default_test_adapter(), get_default_test_adapter())

    def test_real_test_adapter_dry_run_accepts_allowed_commands(self):
        with tempfile.TemporaryDirectory() as repo_root:
            adapter = RealTestAdapter(repo_root=repo_root, dry_run=True)

            result = adapter.run_tests(["npm test", "pytest -q"])

            self.assertTrue(result["ok"])
            self.assertTrue(result["passed"])
            self.assertEqual(result["mode"], "real_test_dry_run")
            self.assertEqual(result["commands"][0]["status"], "dry_run")

    def test_real_test_adapter_blocks_non_whitelisted_commands(self):
        with tempfile.TemporaryDirectory() as repo_root:
            adapter = RealTestAdapter(repo_root=repo_root, dry_run=True)

            result = adapter.run_tests(["rm -rf ."])

            self.assertFalse(result["ok"])
            self.assertFalse(result["passed"])
            self.assertEqual(result["commands"][0]["status"], "blocked")
            self.assertEqual(result["commands"][0]["exit_code"], 126)


if __name__ == "__main__":
    unittest.main()
