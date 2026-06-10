import io
import json
import os
import sys
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "agent_core"))

import main as cli_main
from orchestrator.state import AgentState
from patches.code_patch import build_code_patch


class BytesPipe:
    def __init__(self, data):
        self.buffer = io.BytesIO(data)

    def isatty(self):
        return False


class SequenceActionAdapter:
    def __init__(self, decisions):
        self.decisions = list(decisions)

    def decide_action(self, state, available_actions, model_info):
        return {"thought": "unused", "tool": "finish", "args": {"selected_model": model_info["model"]}}

    def decide_action_with_llm(self, state, available_actions, model_info):
        if self.decisions:
            return dict(self.decisions.pop(0))
        return {
            "ok": True,
            "action": "summarize_result",
            "tool": "finish",
            "reason": "Complete test run",
            "confidence": 0.9,
            "provider": "fake",
            "model": "fake-model",
        }


class MainCliTest(unittest.TestCase):
    def _run_main_with_stdout(self):
        output = io.StringIO()
        previous_json = os.environ.get("AGENT_OUTPUT_JSON")
        os.environ["AGENT_OUTPUT_JSON"] = "1"
        try:
            with redirect_stdout(output):
                cli_main.main()
        finally:
            if previous_json is None:
                os.environ.pop("AGENT_OUTPUT_JSON", None)
            else:
                os.environ["AGENT_OUTPUT_JSON"] = previous_json
        return output.getvalue()

    def _assert_article_word_stats_json_result(self, output):
        data = json.loads(output)
        self.assertIn(data["status"], {"success", "preview"})
        self.assertEqual(data["matched_skill_id"], "article-word-stats")
        self.assertIs(data["validation_result"]["approved"], True)
        self.assertIs(data["review_result"]["approved"], True)
        return data

    def test_interactive_input_matches_article_word_stats(self):
        with patch("builtins.input", return_value="please add word count and reading time to article page"):
            output = self._run_main_with_stdout()

        self._assert_article_word_stats_json_result(output)

    def test_piped_input_matches_article_word_stats(self):
        stdin = io.StringIO("please add word count and reading time to article page\n")
        with patch.object(sys, "stdin", stdin):
            output = self._run_main_with_stdout()

        self._assert_article_word_stats_json_result(output)

    def test_lossy_powershell_piped_input_matches_article_word_stats(self):
        stdin = BytesPipe(b"???????????\r\n")
        with patch.object(sys, "stdin", stdin):
            output = self._run_main_with_stdout()

        self._assert_article_word_stats_json_result(output)

    def test_empty_piped_input_returns_validation_message(self):
        stdin = io.StringIO("\n")
        with patch.object(sys, "stdin", stdin):
            data = json.loads(self._run_main_with_stdout())

        self.assertEqual(data["status"], "failed")
        self.assertIn("Requirement cannot be empty", data["summary"]["message"])
        self.assertIn("Requirement cannot be empty", data["risks"]["last_error"])

    def test_unknown_requirement_uses_default_plan_successfully(self):
        stdin = io.StringIO("add homepage night mode toggle\n")
        with patch.object(sys, "stdin", stdin):
            data = json.loads(self._run_main_with_stdout())

        self.assertIn(data["status"], {"success", "preview", "clarification_required", "planning_paused", "blocked"})
        self.assertIn("summary", data)
        self.assertIn("message", data["summary"])
    def test_json_output_mode_returns_valid_json(self):
        stdin = io.StringIO("鏂囩珷璇︽儏椤垫柊澧炲瓧鏁扮粺璁n")
        with patch.object(sys, "stdin", stdin), patch.dict(os.environ, {"AGENT_OUTPUT_JSON": "1"}, clear=True):
            output = self._run_main_with_stdout()

        data = json.loads(output)
        self.assertEqual(data["task_id"], "demo_task")
        self.assertIn(data["status"], {"success", "preview"})

    def test_json_output_success_fields_are_complete(self):
        stdin = io.StringIO("鏂囩珷璇︽儏椤垫柊澧炲瓧鏁扮粺璁n")
        with patch.object(sys, "stdin", stdin), patch.dict(os.environ, {"AGENT_OUTPUT_JSON": "1"}, clear=True):
            data = json.loads(self._run_main_with_stdout())

        required = {
            "task_id",
            "status",
            "task_name",
            "steps",
            "selected_actions",
            "located_files",
            "patch_plan",
            "review_result",
            "execution_result",
            "verification_result",
            "summary",
            "risks",
            "safety_gates",
            "events_count",
        }
        self.assertTrue(required.issubset(data.keys()))
        self.assertIsInstance(data["selected_actions"], list)
        self.assertIsInstance(data["verification_result"], dict)
        self.assertGreaterEqual(data["steps"], 1)

    def test_json_output_escapes_codepatch_jsx_regex_and_invalid_unicode(self):
        before = "export default function Article() {\n  return <main>{article.body}</main>;\n}\n"
        after = (
            "export default function Article() {\n"
            "  const words = String(article.body || \"\").trim().split(/\\s+/);\n"
            "  return <main className=\"article-body\">{words.length}</main>;\n"
            "}\n"
        )
        code_patch = build_code_patch("frontend/src/pages/Article.jsx", before, after)
        state = AgentState(task_id="json_escape_test", user_input="demo json")
        state.status = "SUCCESS"
        state.artifacts["patch_plan"] = {
            "summary": "Patch with JSX, quotes, backslashes, regex, and diff",
            "patches": [code_patch],
            "code_patches": [code_patch],
        }
        state.artifacts["validation_result"] = {"approved": True, "syntax_valid": True, "errors": [], "warnings": []}
        state.artifacts["review"] = {"approved": True, "risk_level": "low", "issues": [], "checks": {}}
        state.artifacts["execution_result"] = {"executed": True, "files": [{"file": code_patch["file"], "status": "dry_run"}]}
        state.artifacts["verification_result"] = {"passed": True, "verified": True}
        state.artifacts["pr_draft"] = {"summary": "Contains quote \" and path C:\\tmp\\Article.jsx"}
        state.artifacts["llm_metrics"] = [{"stage": "test", "raw": "bad surrogate \udcff"}]
        state.artifacts["historical_recall"] = {"known_risks": ["regex /\\s+/", "JSX <main>{x}</main>"]}

        stdin = io.StringIO("demo json\n")
        with patch.object(sys, "stdin", stdin), \
             patch.dict(os.environ, {"AGENT_OUTPUT_JSON": "1"}, clear=True), \
             patch("main.run_agent", return_value=state):
            stdout = self._run_main_with_stdout()

        data = json.loads(stdout)
        code_patch = data["patch_plan"]["code_patches"][0]
        self.assertIn("<main", code_patch["after_snippet"])
        self.assertIn("/\\s+/", code_patch["after_snippet"])
        self.assertIn("--- a/frontend/src/pages/Article.jsx", code_patch["diff"])
        self.assertIn("validation_result", data)
        self.assertIn("review_result", data)
        self.assertEqual(data["validation_result"]["approved"], True)

    def test_json_safe_search_terms_round_trip(self):
        terms = ["stats", "mojibake-a", "mojibake-b", "unicode snowman \u2603", "reading-time"]
        result = cli_main._json_safe({"located_files": {"search_terms": terms}})

        text = json.dumps(result, ensure_ascii=False)
        parsed = json.loads(text)

        self.assertEqual(parsed["located_files"]["search_terms"], terms)
        self.assertTrue(all(isinstance(item, str) for item in parsed["located_files"]["search_terms"]))

    def test_json_output_with_mojibake_search_terms_is_parseable(self):
        terms = ["stats", "mojibake-a", "mojibake-b", "unicode snowman \u2603", "reading-time", "private-use \ue1f0"]
        state = AgentState(task_id="json_search_terms_test", user_input="demo json")
        state.status = "SUCCESS"
        state.artifacts["located_files"] = {
            "located": True,
            "files": [{"path": "frontend/src/pages/Article.jsx"}],
            "search_terms": terms,
        }
        state.artifacts["patch_plan"] = {"summary": "No code patch", "patches": [{"file": "frontend/src/pages/Article.jsx"}]}
        state.artifacts["validation_result"] = {"approved": True, "syntax_valid": True, "errors": [], "warnings": []}
        state.artifacts["review"] = {"approved": True, "risk_level": "low", "issues": [], "checks": {}}
        state.artifacts["execution_result"] = {"executed": True, "files": []}
        state.artifacts["verification_result"] = {"passed": True, "verified": True}

        stdin = io.StringIO("demo json\n")
        with patch.object(sys, "stdin", stdin), \
             patch.dict(os.environ, {"AGENT_OUTPUT_JSON": "1"}, clear=True), \
             patch("main.run_agent", return_value=state):
            stdout = self._run_main_with_stdout()

        data = json.loads(stdout)
        self.assertEqual(data["located_files"]["search_terms"][:5], terms[:5])
        self.assertIn("validation_result", data)
        self.assertIn("review_result", data)

    def test_print_json_result_writes_utf8_bytes_when_stdout_has_buffer(self):
        class BytesStdout:
            def __init__(self):
                self.buffer = io.BytesIO()

            def write(self, _text):
                raise AssertionError("text write should not be used when buffer exists")

        stdout = BytesStdout()
        with patch.object(sys, "stdout", stdout):
            cli_main._print_json_result({"text": "private-use \ue1f0 and JSX <main />"})

        data = json.loads(stdout.buffer.getvalue().decode("utf-8"))
        self.assertIn("<main />", data["text"])

    def test_print_json_result_search_terms_bytes_round_trip(self):
        class BytesStdout:
            def __init__(self):
                self.buffer = io.BytesIO()

            def write(self, _text):
                raise AssertionError("text write should not be used when buffer exists")

        terms = ["stats", "mojibake-a", "mojibake-b"]
        stdout = BytesStdout()
        with patch.object(sys, "stdout", stdout):
            cli_main._print_json_result({"located_files": {"search_terms": terms}})

        raw = stdout.buffer.getvalue()
        text = raw.decode("utf-8")
        data = json.loads(text)
        self.assertEqual(data["located_files"]["search_terms"], terms)
        self.assertTrue(text.rstrip().endswith("}}"))
        self.assertIn('"mojibake-a"', text)

    def test_print_json_result_self_validation_fallback(self):
        with patch("main.json.dumps", side_effect=['{"status":"ok","bad":"unterminated', '{"bad_position": 22, "details": "bad", "error": "json_output_validation_failed", "json_output_error_context": "ctx", "status": "failed"}']):
            output = io.StringIO()
            error = io.StringIO()
            with redirect_stdout(output), patch.object(sys, "stderr", error):
                cli_main._print_json_result({"status": "ok"})

        data = json.loads(output.getvalue())
        self.assertEqual(data["status"], "failed")
        self.assertEqual(data["error"], "json_output_validation_failed")
        self.assertIn('"bad"', error.getvalue())

    def test_json_output_failed_run_is_structured(self):
        stdin = io.StringIO("demo failure\n")
        env = {"AGENT_OUTPUT_JSON": "1", "AGENT_TEST_UNKNOWN_TOOL": "1"}
        with patch.object(sys, "stdin", stdin), patch.dict(os.environ, env, clear=True):
            data = json.loads(self._run_main_with_stdout())

        self.assertEqual(data["status"], "failed")
        self.assertEqual(data["raw_status"], "FAILED")
        self.assertIn("selected_actions", data)
        self.assertIn("risks", data)

    def test_json_output_empty_input_is_structured(self):
        stdin = io.StringIO("\n")
        with patch.object(sys, "stdin", stdin), patch.dict(os.environ, {"AGENT_OUTPUT_JSON": "1"}, clear=True):
            data = json.loads(self._run_main_with_stdout())

        self.assertEqual(data["status"], "failed")
        self.assertEqual(data["summary"]["message"], "Requirement cannot be empty")
        self.assertEqual(data["selected_actions"], [])

    def test_plain_text_task_input_still_runs(self):
        stdin = io.StringIO("add a small frontend note\n")
        with patch.object(sys, "stdin", stdin), patch.dict(os.environ, {"AGENT_OUTPUT_JSON": "1"}, clear=True):
            data = json.loads(self._run_main_with_stdout())

        self.assertIn(data["status"], {"success", "preview"})
        self.assertIsNone(data["requirement_id"])
        self.assertIn("task_name", data)

    def test_json_dsl_input_runs_and_fields_enter_result(self):
        dsl = {
            "requirement_id": "REQ-DSL-1",
            "task_name": "Add billing export",
            "user_story": "As an operator I can export billing data",
            "requirement_type": "backend",
            "target_modules": ["backend/src/billing/export.py"],
            "acceptance_criteria": ["CSV export is available"],
            "constraints": ["Do not change auth policy"],
            "skill_hint": "billing-export",
            "test_commands": ["python -m unittest discover -s codex-verify -v"],
            "risk_level": "medium",
        }
        stdin = io.StringIO(json.dumps(dsl))
        with patch.object(sys, "stdin", stdin), patch.dict(os.environ, {"AGENT_OUTPUT_JSON": "1"}, clear=True):
            data = json.loads(self._run_main_with_stdout())

        self.assertIn(data["status"], {"success", "preview"})
        self.assertEqual(data["requirement_id"], "REQ-DSL-1")
        self.assertEqual(data["requirement_type"], "backend")
        self.assertEqual(data["skill_hint"], "billing-export")
        self.assertEqual(data["task_name"], "Add billing export")
        self.assertEqual(data["matched_skill_id"], "generic")
        self.assertEqual(data["matched_skill_name"], "generic")
        self.assertEqual(data["skill_match_reason"], "generic_fallback")
        self.assertEqual(data["patch_plan"]["requirement_id"], "REQ-DSL-1")
        self.assertEqual(data["review_result"]["requirement_id"], "REQ-DSL-1")
        self.assertEqual(data["verification_result"]["requirement_id"], "REQ-DSL-1")
        self.assertEqual(data["summary"]["requirement_id"], "REQ-DSL-1")
        self.assertEqual(data["acceptance_criteria_coverage"]["requirement_id"], "REQ-DSL-1")

    def test_json_dsl_with_llm_action_decision_does_not_fail_on_missing_skill(self):
        dsl_path = Path(__file__).resolve().parents[1] / "agent_core" / "examples" / "dsl" / "l1_article_word_stats.json"
        dsl = json.loads(dsl_path.read_text(encoding="utf-8"))
        dsl.pop("target_repo", None)
        dsl["task_name"] = "Add article word count and reading time"
        dsl["user_story"] = "As a reader, I can see word count and estimated reading time on the article detail page."
        dsl["requirement_type"] = "frontend_l1"
        adapter = SequenceActionAdapter([
            {
                "ok": True,
                "action": "plan_task",
                "tool": "make_plan",
                "reason": "Try planning before skill selection",
                "confidence": 0.9,
                "provider": "fake",
                "model": "fake-model",
            },
            {
                "ok": True,
                "action": "summarize_result",
                "tool": "finish",
                "reason": "Stop after dependency fallback proves safe",
                "confidence": 0.9,
                "provider": "fake",
                "model": "fake-model",
            },
        ])
        env = {"AGENT_OUTPUT_JSON": "1", "AGENT_LLM_ACTION_DECISION": "1"}

        with patch.object(sys, "stdin", io.StringIO(json.dumps(dsl))), \
             patch.dict(os.environ, env, clear=True), \
             patch("agent_core.agents.fake_agent.get_default_llm_adapter", return_value=adapter):
            data = json.loads(self._run_main_with_stdout())

        self.assertNotEqual(data["status"], "failed")
        self.assertTrue(data["selected_actions"])
        self.assertEqual(data["selected_actions"][0]["decision_source"], "fallback")
        self.assertEqual(data["selected_actions"][0]["reason"], "missing_dependency: matched_skill")

    def test_invalid_json_dsl_returns_structured_failure(self):
        stdin = io.StringIO('{"requirement_id": 123, "task_name": "Bad DSL"}')
        with patch.object(sys, "stdin", stdin), patch.dict(os.environ, {"AGENT_OUTPUT_JSON": "1"}, clear=True):
            data = json.loads(self._run_main_with_stdout())

        self.assertEqual(data["status"], "failed")
        self.assertEqual(data["raw_status"], "FAILED")
        self.assertIn("requirement_id must be a string", data["summary"]["message"])
        self.assertEqual(data["selected_actions"], [])


if __name__ == "__main__":
    unittest.main()

