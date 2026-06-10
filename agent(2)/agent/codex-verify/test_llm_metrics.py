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
from interfaces.event_adapter import MockEventAdapter
from interfaces.memory_adapter import InMemoryMemoryAdapter
from observability.llm_metrics import build_llm_call_metric
from orchestrator.state import AgentState
from tools.tool_registry import execute


class FakeGenerateAdapter:
    def __init__(self, result):
        self.result = result

    def generate(self, prompt, system_prompt=None, temperature=0.2):
        return dict(self.result)


class LlmMetricsTest(unittest.TestCase):
    def _planner_state(self):
        state = AgentState(task_id="llm_metrics_planner", user_input="Create plan")
        state.matched_skill = {"id": "generic", "name": "generic"}
        return state

    def test_success_llm_call_records_metrics(self):
        state = self._planner_state()
        memory = InMemoryMemoryAdapter()
        events = MockEventAdapter()
        adapter = FakeGenerateAdapter(
            {
                "ok": True,
                "provider": "fake",
                "model": "fake-model",
                "text": json.dumps(
                    {
                        "plan": "Plan from LLM",
                        "intent": "Do it",
                        "risk_level": "low",
                        "suggested_files": ["note.txt"],
                        "test_commands": ["python -m unittest"],
                    }
                ),
                "raw": {"usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}},
            }
        )

        with patch.dict(os.environ, {"AGENT_USE_LLM_PLANNER": "1"}, clear=True), \
             patch("agents.planner_agent.get_default_llm_adapter", return_value=adapter), \
             patch("tools.tool_registry.get_default_memory_adapter", return_value=memory), \
             patch("tools.tool_registry.get_default_event_adapter", return_value=events):
            execute({"tool": "make_plan", "args": {}}, state)

        metric = state.artifacts["llm_metrics"][0]
        self.assertTrue(metric["success"])
        self.assertEqual(metric["stage"], "planner")
        self.assertEqual(metric["total_tokens"], 15)
        self.assertEqual(state.artifacts["llm_metrics_summary"]["total_calls"], 1)
        self.assertTrue(any(event["type"] == "LLM_CALL_RECORDED" for event in events.events_by_task[state.task_id]))
        self.assertTrue(any(event["stage"] == "llm_metrics" for event in memory.events))
        self.assertTrue(any(item["agent_name"] == "observabilityAgent" for item in state.context_snapshots))

    def test_failed_llm_call_records_error_metrics(self):
        state = self._planner_state()
        adapter = FakeGenerateAdapter(
            {
                "ok": False,
                "provider": "fake",
                "model": "fake-model",
                "text": "",
                "error": "timeout: fake",
            }
        )

        with patch.dict(os.environ, {"AGENT_USE_LLM_PLANNER": "1"}, clear=True), \
             patch("agents.planner_agent.get_default_llm_adapter", return_value=adapter):
            execute({"tool": "make_plan", "args": {}}, state)

        metric = state.artifacts["llm_metrics"][0]
        self.assertFalse(metric["success"])
        self.assertEqual(metric["error_type"], "timeout")
        self.assertEqual(state.artifacts["llm_metrics_summary"]["failed_calls"], 1)
        self.assertIn("plan", state.artifacts)

    def test_missing_usage_uses_token_fallback(self):
        metric = build_llm_call_metric(
            "planner",
            {"ok": True, "provider": "fake", "model": "fake-model", "text": "hello world"},
            prompt="hello " * 20,
            system_prompt="system",
            started_ms=10,
            ended_ms=20,
        )

        self.assertGreater(metric["prompt_tokens"], 0)
        self.assertGreater(metric["completion_tokens"], 0)
        self.assertEqual(metric["latency_ms"], 10)

    def test_secret_like_content_does_not_enter_metrics(self):
        metric = build_llm_call_metric(
            "planner",
            {"ok": True, "provider": "fake", "model": "fake-model", "text": "secret TOKEN=abc"},
            prompt="DOUBAO_API_KEY=abc .env token secret",
            system_prompt="system",
            started_ms=1,
            ended_ms=2,
        )
        serialized = json.dumps(metric)

        self.assertNotIn("DOUBAO_API_KEY", serialized)
        self.assertNotIn("TOKEN=abc", serialized)
        self.assertNotIn(".env", serialized)

    def test_json_result_contains_llm_metrics_summary(self):
        stdin = io.StringIO("Create note with llm\n")
        output = io.StringIO()
        adapter = FakeGenerateAdapter(
            {
                "ok": True,
                "provider": "fake",
                "model": "fake-model",
                "text": json.dumps(
                    {
                        "plan": "JSON LLM Plan",
                        "intent": "Do it",
                        "risk_level": "low",
                        "suggested_files": ["note.txt"],
                        "test_commands": [],
                    }
                ),
            }
        )
        with patch.object(sys, "stdin", stdin), \
             patch.dict(os.environ, {"AGENT_OUTPUT_JSON": "1", "AGENT_USE_LLM_PLANNER": "1"}, clear=True), \
             patch("agents.planner_agent.get_default_llm_adapter", return_value=adapter), \
             redirect_stdout(output):
            cli_main.main()

        data = json.loads(output.getvalue())
        self.assertIn("llm_metrics", data)
        self.assertIn("llm_metrics_summary", data)
        self.assertGreaterEqual(data["llm_metrics_summary"]["total_calls"], 1)
        self.assertIn("planner", data["llm_metrics_summary"]["calls_by_stage"])


if __name__ == "__main__":
    unittest.main()
