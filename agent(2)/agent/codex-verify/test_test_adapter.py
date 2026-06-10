import sys
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "agent_core"))

from agents.verifier_agent import verify_execution
from interfaces import test_adapter as test_adapter_module
from interfaces import repo_adapter as repo_adapter_module
from interfaces.event_adapter import MockEventAdapter
from interfaces.memory_adapter import InMemoryMemoryAdapter
from interfaces.test_adapter import MockTestAdapter, RealTestAdapter, get_default_test_adapter
from orchestrator.agent_loop import run_agent
from orchestrator.state import AgentState
from tools.tool_registry import execute


class TestAdapterTest(unittest.TestCase):
    def setUp(self):
        test_adapter_module._DEFAULT_TEST_ADAPTER = None
        repo_adapter_module._DEFAULT_REPO_ADAPTER = None

    def tearDown(self):
        test_adapter_module._DEFAULT_TEST_ADAPTER = None
        repo_adapter_module._DEFAULT_REPO_ADAPTER = None

    def test_mock_test_adapter_passes_commands(self):
        result = MockTestAdapter().run_tests(["npm run lint", "npm test"])

        self.assertTrue(result["ok"])
        self.assertTrue(result["passed"], result)
        self.assertEqual(len(result["commands"]), 2)
        self.assertEqual(result["commands"][0]["status"], "passed")

    def test_verify_execution_uses_default_lint_when_plan_has_no_commands(self):
        result = verify_execution(
            plan={},
            execution_result={"executed": True},
            test_adapter=MockTestAdapter(),
        )

        self.assertTrue(result["verified"])
        self.assertTrue(result["passed"], result)
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

    def test_real_test_adapter_generates_verify_preview(self):
        adapter = RealTestAdapter("D:\\python\\PythonProject", reason="python project detected")

        result = adapter.run_tests(["pytest", "python -m unittest discover -s tests -v"])

        self.assertTrue(result["ok"])
        self.assertIsNone(result["passed"])
        self.assertFalse(result["executed"])
        self.assertEqual(result["mode"], "verify_preview_only")
        self.assertEqual(result["verify_preview"]["working_directory"], "D:\\python\\PythonProject")
        self.assertIn("python -m unittest discover -s tests -v", result["verify_preview"]["commands"])

    def test_real_test_adapter_default_preview_does_not_execute(self):
        adapter = RealTestAdapter("D:\\repo")

        with patch.dict(os.environ, {}, clear=True):
            result = adapter.run_tests(["python -m unittest discover -s codex-verify -v"])

        self.assertFalse(result["executed"])
        self.assertEqual(result["mode"], "verify_preview_only")
        self.assertIn("AGENT_TEST_RUN=1", result["missing_execution_gates"])

    def test_real_test_adapter_run_without_confirm_does_not_execute(self):
        adapter = RealTestAdapter("D:\\repo")

        with patch.dict(os.environ, {"AGENT_TEST_RUN": "1"}, clear=True):
            result = adapter.run_tests(["python -m unittest discover -s codex-verify -v"])

        self.assertFalse(result["executed"])
        self.assertEqual(result["mode"], "verify_preview_only")
        self.assertIn("AGENT_TEST_CONFIRM=YES", result["missing_execution_gates"])

    def test_real_test_adapter_executes_whitelisted_unittest_command(self):
        with tempfile.TemporaryDirectory() as repo_root:
            tests_dir = Path(repo_root) / "tests"
            tests_dir.mkdir()
            (tests_dir / "test_sample.py").write_text(
                "import unittest\n\nclass SampleTest(unittest.TestCase):\n    def test_ok(self):\n        self.assertTrue(True)\n",
                encoding="utf-8",
            )
            adapter = RealTestAdapter(repo_root)

            completed = subprocess.CompletedProcess(
                args=["python", "-m", "unittest"],
                returncode=0,
                stdout="ok stdout",
                stderr="ok stderr",
            )
            with patch.dict(os.environ, {"AGENT_TEST_RUN": "1", "AGENT_TEST_CONFIRM": "YES"}, clear=True), \
                 patch("interfaces.test_adapter.subprocess.run", return_value=completed) as run_mock:
                result = adapter.run_tests(["python -m unittest discover -s tests -v"])

        self.assertTrue(result["executed"])
        self.assertTrue(result["passed"], result)
        self.assertEqual(result["mode"], "test_execution")
        self.assertEqual(result["commands"][0]["exit_code"], 0)
        self.assertEqual(result["commands"][0]["stdout"], "ok stdout")
        self.assertEqual(result["commands"][0]["stderr"], "ok stderr")
        self.assertFalse(run_mock.call_args.kwargs["shell"])
        self.assertEqual(run_mock.call_args.kwargs["cwd"], str(Path(repo_root).resolve()))
        self.assertTrue(run_mock.call_args.kwargs["capture_output"])

    def test_windows_npm_normalizes_to_npm_cmd(self):
        with tempfile.TemporaryDirectory() as repo_root:
            adapter = RealTestAdapter(repo_root)
            completed = subprocess.CompletedProcess(
                args=["D:\\app\\node\\npm.cmd", "test"],
                returncode=0,
                stdout="ok",
                stderr="",
            )
            with patch.dict(os.environ, {"AGENT_TEST_RUN": "1", "AGENT_TEST_CONFIRM": "YES"}, clear=True), \
                 patch("interfaces.test_adapter.os.name", "nt"), \
                 patch("interfaces.test_adapter.shutil.which", return_value="D:\\app\\node\\npm.cmd"), \
                 patch("interfaces.test_adapter.subprocess.run", return_value=completed) as run_mock:
                result = adapter.run_tests(["npm test"])

        self.assertTrue(result["executed"])
        self.assertTrue(result["passed"], result)
        self.assertEqual(run_mock.call_args.args[0][0], "D:\\app\\node\\npm.cmd")
        self.assertEqual(run_mock.call_args.args[0][1:], ["test"])

    def test_windows_npm_run_lint_normalizes_to_npm_cmd(self):
        with tempfile.TemporaryDirectory() as repo_root:
            adapter = RealTestAdapter(repo_root)
            completed = subprocess.CompletedProcess(
                args=["D:\\app\\node\\npm.cmd", "run", "lint"],
                returncode=0,
                stdout="lint ok",
                stderr="",
            )
            with patch.dict(os.environ, {"AGENT_TEST_RUN": "1", "AGENT_TEST_CONFIRM": "YES"}, clear=True), \
                 patch("interfaces.test_adapter.os.name", "nt"), \
                 patch("interfaces.test_adapter.shutil.which", return_value="D:\\app\\node\\npm.cmd"), \
                 patch("interfaces.test_adapter.subprocess.run", return_value=completed) as run_mock:
                result = adapter.run_tests(["npm run lint"])

        self.assertTrue(result["executed"])
        self.assertTrue(result["passed"], result)
        self.assertEqual(run_mock.call_args.args[0], ["D:\\app\\node\\npm.cmd", "run", "lint"])

    def test_shell_false_is_preserved(self):
        with tempfile.TemporaryDirectory() as repo_root:
            adapter = RealTestAdapter(repo_root)
            completed = subprocess.CompletedProcess(
                args=["D:\\app\\node\\npm.cmd", "run", "test"],
                returncode=0,
                stdout="ok",
                stderr="",
            )
            with patch.dict(os.environ, {"AGENT_TEST_RUN": "1", "AGENT_TEST_CONFIRM": "YES"}, clear=True), \
                 patch("interfaces.test_adapter.os.name", "nt"), \
                 patch("interfaces.test_adapter.shutil.which", return_value="D:\\app\\node\\npm.cmd"), \
                 patch("interfaces.test_adapter.subprocess.run", return_value=completed) as run_mock:
                adapter.run_tests(["npm run test"])

        self.assertFalse(run_mock.call_args.kwargs["shell"])

    def test_real_test_adapter_rejects_non_whitelisted_execution_command(self):
        with tempfile.TemporaryDirectory() as repo_root:
            adapter = RealTestAdapter(repo_root)

            with patch.dict(os.environ, {"AGENT_TEST_RUN": "1", "AGENT_TEST_CONFIRM": "YES"}, clear=True):
                result = adapter.run_tests(["python setup.py test"])

        self.assertFalse(result["executed"])
        self.assertEqual(result["mode"], "verify_preview_skipped")
        self.assertEqual(result["rejected_commands"], ["python setup.py test"])

    def test_real_test_adapter_records_timeout(self):
        with tempfile.TemporaryDirectory() as repo_root:
            adapter = RealTestAdapter(repo_root)

            with patch.dict(
                os.environ,
                {"AGENT_TEST_RUN": "1", "AGENT_TEST_CONFIRM": "YES", "AGENT_TEST_TIMEOUT": "5"},
                clear=True,
            ), patch("interfaces.test_adapter.subprocess.run", side_effect=subprocess.TimeoutExpired("python -c", 5)):
                result = adapter.run_tests(["python -c \"import time; time.sleep(1)\""])

        self.assertTrue(result["executed"])
        self.assertFalse(result["passed"])
        self.assertEqual(result["commands"][0]["status"], "timeout", result)
        self.assertTrue(result["commands"][0]["timed_out"])
        self.assertIsNone(result["commands"][0]["exit_code"])

    def test_real_test_adapter_rejects_dangerous_commands(self):
        adapter = RealTestAdapter("D:\\repo")

        result = adapter.run_tests(["pytest", "powershell Remove-Item note.txt", "python -m unittest > out.txt"])

        self.assertTrue(result["ok"])
        self.assertIsNone(result["passed"])
        self.assertFalse(result["executed"])
        self.assertEqual(result["mode"], "verify_preview_only")
        self.assertEqual(result["verify_preview"]["commands"], ["pytest"])
        self.assertEqual(len(result["rejected_commands"]), 2)

    def test_real_test_adapter_filters_cat_and_ls_from_preview(self):
        adapter = RealTestAdapter("D:\\repo")

        result = adapter.run_tests(["cat note.txt", "ls -l note.txt"])

        self.assertTrue(result["ok"])
        self.assertEqual(result["mode"], "verify_preview_skipped")
        self.assertFalse(result["verification_required"])
        self.assertEqual(result["verify_preview"]["commands"], [])
        self.assertEqual(len(result["rejected_commands"]), 2)

    def test_real_test_adapter_allows_whitelisted_commands_in_preview(self):
        adapter = RealTestAdapter("D:\\repo")

        result = adapter.run_tests(["pytest", "npm run lint", "ruff check .", "mypy src"])

        self.assertTrue(result["ok"])
        self.assertEqual(result["mode"], "verify_preview_only")

    def test_agent_flow_saves_verify_preview_in_real_repo_mode(self):
        with tempfile.TemporaryDirectory() as repo_root:
            with patch.dict(os.environ, {"AGENT_REPO_MODE": "real", "AGENT_REPO_ROOT": repo_root}, clear=True):
                test_adapter_module._DEFAULT_TEST_ADAPTER = None
                state = run_agent("创建 note.txt 文件，内容为 100", task_id="verify_preview_state_test")

        verification_result = state.artifacts["verification_result"]
        self.assertIn("verify_preview", state.artifacts)
        self.assertEqual(verification_result["mode"], "verify_preview_only")
        self.assertIsNone(verification_result["passed"])
        self.assertFalse(verification_result["verified"])
        self.assertEqual(len(state.artifacts["verify_preview"]["commands"]), 1)
        self.assertTrue(state.artifacts["verify_preview"]["commands"][0].startswith("python -c "))

    def test_agent_verify_env_marks_preview_ready_without_executing(self):
        with tempfile.TemporaryDirectory() as repo_root:
            with patch.dict(
                os.environ,
                {"AGENT_REPO_MODE": "real", "AGENT_REPO_ROOT": repo_root, "AGENT_VERIFY": "1"},
                clear=True,
            ):
                test_adapter_module._DEFAULT_TEST_ADAPTER = None
                state = run_agent("创建 note.txt 文件，内容为 100", task_id="verify_preview_ready_test")

        verification_result = state.artifacts["verification_result"]
        self.assertEqual(verification_result["mode"], "verify_preview_ready")
        self.assertIsNone(verification_result["passed"])
        self.assertFalse(verification_result["verified"])

    def test_verify_execution_filters_llm_cat_ls_commands(self):
        result = verify_execution(
            plan={"test_commands": ["cat note.txt", "ls -l note.txt"]},
            execution_result={"executed": True, "files": []},
            test_adapter=RealTestAdapter("D:\\repo"),
        )

        self.assertEqual(result["mode"], "verify_preview_skipped")
        self.assertFalse(result["verification_required"])
        self.assertEqual(result["verify_preview"]["commands"], [])

    def test_verify_execution_generates_safe_python_command_for_create_file(self):
        result = verify_execution(
            plan={"test_commands": ["cat note.txt", "ls -l note.txt"]},
            execution_result={
                "executed": True,
                "files": [
                    {
                        "operation": "create_file",
                        "file": "note.txt",
                        "content_preview": "100",
                    }
                ],
            },
            test_adapter=RealTestAdapter("D:\\repo"),
        )

        commands = result["verify_preview"]["commands"]
        self.assertEqual(result["mode"], "verify_preview_only")
        self.assertEqual(len(commands), 1)
        self.assertTrue(commands[0].startswith("python -c "))
        self.assertIn("Path('note.txt')", commands[0])
        self.assertNotIn("cat", commands[0])
        self.assertNotIn("ls", commands[0])

    def test_git_diff_verification(self):
        with tempfile.TemporaryDirectory() as repo_root:
            adapter = RealTestAdapter(repo_root)
            completed = subprocess.CompletedProcess(
                args=["git", "diff", "--stat"],
                returncode=0,
                stdout=" Article.jsx | 4 ++++\n 1 file changed, 4 insertions(+)\n",
                stderr="",
            )
            with patch("agents.verifier_agent.subprocess.run", return_value=completed) as run_mock:
                result = verify_execution(
                    plan={},
                    execution_result={"executed": True, "files": [{"file": "Article.jsx", "diff": "+const wordCount = 1;"}]},
                    test_adapter=adapter,
                )

        self.assertIn("git_diff_stat", result)
        self.assertTrue(result["git_diff_stat"]["ok"])
        self.assertIn("Article.jsx", result["git_diff_stat"]["stdout"])
        self.assertEqual(run_mock.call_args.args[0], ["git", "diff", "--stat"])
        self.assertFalse(run_mock.call_args.kwargs["shell"])

    def test_git_diff_missing_git_returns_structured_error(self):
        with tempfile.TemporaryDirectory() as repo_root:
            adapter = RealTestAdapter(repo_root)
            with patch("agents.verifier_agent.subprocess.run", side_effect=FileNotFoundError("git not found")):
                result = verify_execution(
                    plan={},
                    execution_result={"executed": True, "files": [{"file": "Article.jsx", "diff": "+const wordCount = 1;"}]},
                    test_adapter=adapter,
                )

        self.assertIn("git_diff_stat", result)
        self.assertFalse(result["git_diff_stat"]["ok"])
        self.assertEqual(result["git_diff_stat"]["command"], "git diff --stat")
        self.assertIn("git not found", result["git_diff_stat"]["error"])

    def test_execute_verify_result_records_test_executed_event_memory_and_context(self):
        memory = InMemoryMemoryAdapter()
        events = MockEventAdapter()
        with tempfile.TemporaryDirectory() as repo_root:
            tests_dir = Path(repo_root) / "tests"
            tests_dir.mkdir()
            (tests_dir / "test_sample.py").write_text(
                "import unittest\n\nclass SampleTest(unittest.TestCase):\n    def test_ok(self):\n        self.assertTrue(True)\n",
                encoding="utf-8",
            )
            adapter = RealTestAdapter(repo_root)
            state = AgentState(task_id="test_executed_event_test", user_input="run tests")
            state.artifacts["plan"] = {"test_commands": ["python -m unittest discover -s tests -v"]}
            state.artifacts["execution_result"] = {"executed": True, "files": []}

            with patch.dict(os.environ, {"AGENT_TEST_RUN": "1", "AGENT_TEST_CONFIRM": "YES"}, clear=True), \
                 patch("tools.tool_registry.get_default_test_adapter", return_value=adapter), \
                 patch("tools.tool_registry.get_default_memory_adapter", return_value=memory), \
                 patch("tools.tool_registry.get_default_event_adapter", return_value=events):
                observation = execute({"tool": "verify_result", "args": {}}, state)

        self.assertTrue(observation["ok"])
        self.assertTrue(state.artifacts["verification_result"]["test_result"]["executed"])
        self.assertEqual(state.artifacts["last_test_event"]["type"], "TEST_EXECUTED")
        self.assertTrue(any(item["agent_name"] == "verifierAgent" for item in state.context_snapshots))
        self.assertTrue(any(event["action"] == "test_executed" for event in memory.events))


if __name__ == "__main__":
    unittest.main()
