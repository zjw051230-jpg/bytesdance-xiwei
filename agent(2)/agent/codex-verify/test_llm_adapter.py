import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "agent_core"))

from interfaces.llm_adapter import DoubaoLLMAdapter, MockLLMAdapter, get_default_llm_adapter
from orchestrator.state import AgentState


class LLMAdapterTest(unittest.TestCase):
    def test_default_llm_adapter_returns_mock(self):
        with patch.dict(os.environ, {}, clear=True):
            adapter = get_default_llm_adapter()

        self.assertIsInstance(adapter, MockLLMAdapter)

    def test_mock_llm_adapter_generate(self):
        result = MockLLMAdapter().generate("hello")

        self.assertTrue(result["ok"])
        self.assertEqual(result["provider"], "mock")
        self.assertEqual(result["text"], "OK")

    def test_doubao_missing_key_safely_fails(self):
        with patch.dict(os.environ, {"AGENT_LLM_PROVIDER": "doubao", "DOUBAO_ENDPOINT": "ep-test"}, clear=True):
            result = get_default_llm_adapter().generate("hello")

        self.assertFalse(result["ok"])
        self.assertEqual(result["provider"], "doubao")
        self.assertIn("DOUBAO_API_KEY", result["error"])

    def test_doubao_missing_endpoint_safely_fails(self):
        with patch.dict(os.environ, {"AGENT_LLM_PROVIDER": "doubao", "DOUBAO_API_KEY": "test-key"}, clear=True):
            result = get_default_llm_adapter().generate("hello")

        self.assertFalse(result["ok"])
        self.assertEqual(result["provider"], "doubao")
        self.assertIn("DOUBAO_ENDPOINT", result["error"])

    def test_doubao_adapter_does_not_store_hardcoded_key(self):
        adapter = DoubaoLLMAdapter(api_key="runtime-key", endpoint="ep-test")

        self.assertEqual(adapter.api_key, "runtime-key")
        self.assertEqual(adapter.endpoint, "ep-test")

    def test_doubao_action_decision_accepts_strict_json(self):
        adapter = DoubaoLLMAdapter(api_key="runtime-key", endpoint="ep-test")
        state = AgentState(task_id="llm_action_valid", user_input="demo")
        available_actions = [{"name": "locate_files"}]

        with patch.object(adapter, "generate", return_value={
            "ok": True,
            "provider": "doubao",
            "model": "ep-test",
            "text": '{"action":"locate_files","reason":"Need files","confidence":0.82}',
        }):
            result = adapter.decide_action_with_llm(state, available_actions, {"model": "ep-test"})

        self.assertTrue(result["ok"])
        self.assertEqual(result["action"], "locate_files")
        self.assertEqual(result["tool"], "locate_files")
        self.assertEqual(result["confidence"], 0.82)

    def test_doubao_action_decision_rejects_invalid_json(self):
        adapter = DoubaoLLMAdapter(api_key="runtime-key", endpoint="ep-test")
        state = AgentState(task_id="llm_action_invalid", user_input="demo")

        with patch.object(adapter, "generate", return_value={
            "ok": True,
            "provider": "doubao",
            "model": "ep-test",
            "text": "not json",
        }):
            result = adapter.decide_action_with_llm(state, [{"name": "locate_files"}], {"model": "ep-test"})

        self.assertFalse(result["ok"])
        self.assertIn("invalid_json", result["error"])


if __name__ == "__main__":
    unittest.main()
