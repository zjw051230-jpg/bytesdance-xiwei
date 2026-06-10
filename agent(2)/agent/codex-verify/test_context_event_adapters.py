import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "agent_core"))

import interfaces.context_adapter as context_adapter_module
import interfaces.event_adapter as event_adapter_module
from interfaces.context_adapter import ContextServiceAdapter, MockContextAdapter, get_default_context_adapter
from interfaces.event_adapter import ContextEventAdapter, MockEventAdapter, get_default_event_adapter
from orchestrator.agent_loop import run_agent
from orchestrator.state import AgentState


class FakeContextHttpAdapter:
    def __init__(self):
        self.build_payload = None
        self.append_payload = None
        self.latest_seq_called_with = None

    def build_context(self, task_id, agent_name, current_node_id=None):
        self.build_payload = {
            "task_id": task_id,
            "agent_name": agent_name,
            "current_node_id": current_node_id,
        }
        return {
            "ok": True,
            "data": {
                "task_id": task_id,
                "agent_name": agent_name,
                "current_node_id": current_node_id,
                "context": {},
            },
        }

    def append_event(self, task_id, event, expected_seq=None):
        self.append_payload = {
            "task_id": task_id,
            "event": event,
            "expected_seq": expected_seq,
        }
        return {
            "ok": True,
            "event_id": "evt_http",
            "task_id": task_id,
            "seq": 6,
        }

    def latest_seq(self, task_id):
        self.latest_seq_called_with = task_id
        return {
            "ok": True,
            "latestSeq": 5,
        }


class ContextEventAdapterTest(unittest.TestCase):
    def tearDown(self):
        context_adapter_module._DEFAULT_CONTEXT_ADAPTER = None
        event_adapter_module._DEFAULT_EVENT_ADAPTER = None

    def test_mock_context_adapter_returns_safe_default_context(self):
        context = MockContextAdapter().build_context_for_agent(
            task_id="context_adapter_test",
            agent_name="planAgent",
            current_node_id="node_1",
        )

        self.assertEqual(context["task_id"], "context_adapter_test")
        self.assertEqual(context["agent_name"], "planAgent")
        self.assertEqual(context["current_node_id"], "node_1")
        self.assertIn("final_dsl_core", context["context"])
        self.assertEqual(context["source_node_ids"], [])
        self.assertFalse(context["privacy_report"]["redacted"])

    def test_mock_event_adapter_appends_event_sequence(self):
        adapter = MockEventAdapter()
        first = adapter.append_event("event_adapter_test", {"type": "PLAN_CREATED"})
        second = adapter.append_event("event_adapter_test", {"type": "TASK_FINISHED"})

        self.assertEqual(first["event_id"], "evt_1")
        self.assertEqual(first["seq"], 1)
        self.assertEqual(second["seq"], 2)
        self.assertEqual(adapter.get_latest_event_seq("event_adapter_test"), 2)
        self.assertEqual(first["schema_version"], "1")

    def test_agent_state_tracks_nodes_and_context_snapshots(self):
        state = AgentState(task_id="state_context_test", user_input="demo")
        self.assertEqual(state.run_id, "run_state_context_test")

        state.add_node("plan_1", "plan")
        state.add_context_snapshot("planAgent", {"source_node_ids": []})

        self.assertEqual(state.current_node_id, "plan_1")
        self.assertEqual(state.node_history[0]["node_id"], "plan_1")
        self.assertEqual(state.context_snapshots[0]["agent_name"], "planAgent")

    def test_full_agent_flow_records_context_nodes_events_and_summary(self):
        state = run_agent("demo requirement", task_id="context_event_flow_test")

        agent_names = {item["agent_name"] for item in state.context_snapshots}

        self.assertEqual(state.status, "SUCCESS")
        self.assertTrue(state.node_history)
        self.assertIn("planAgent", agent_names)
        self.assertIn("codegenAgent", agent_names)
        self.assertIn("deliveryAgent", agent_names)
        self.assertIn("last_event", state.artifacts)
        self.assertIn("final_summary", state.artifacts)
        self.assertEqual(state.artifacts["last_event"]["type"], "TASK_FINISHED")

    def test_default_adapters_are_singletons(self):
        self.assertIs(get_default_context_adapter(), get_default_context_adapter())
        self.assertIs(get_default_event_adapter(), get_default_event_adapter())

    def test_context_adapter_uses_http_build_when_enabled(self):
        fake_http = FakeContextHttpAdapter()

        with patch.dict(os.environ, {"USE_CONTEXT_HTTP": "1"}, clear=True):
            context_adapter_module._DEFAULT_CONTEXT_ADAPTER = None
            with patch(
                "interfaces.context_adapter.get_default_context_http_adapter",
                return_value=fake_http,
            ):
                adapter = get_default_context_adapter()
                context = adapter.build_context_for_agent("task_http", "planAgent", "node_1")

        self.assertIsInstance(adapter, ContextServiceAdapter)
        self.assertEqual(fake_http.build_payload["task_id"], "task_http")
        self.assertEqual(fake_http.build_payload["agent_name"], "planAgent")
        self.assertEqual(fake_http.build_payload["current_node_id"], "node_1")
        self.assertEqual(context["task_id"], "task_http")

    def test_event_adapter_uses_http_append_when_enabled(self):
        fake_http = FakeContextHttpAdapter()

        with patch.dict(os.environ, {"USE_CONTEXT_HTTP": "1"}, clear=True):
            event_adapter_module._DEFAULT_EVENT_ADAPTER = None
            with patch(
                "interfaces.event_adapter.get_default_context_http_adapter",
                return_value=fake_http,
            ):
                adapter = get_default_event_adapter()
                latest_seq = adapter.get_latest_event_seq("task_http")
                response = adapter.append_event(
                    "task_http",
                    {"type": "PLAN_CREATED"},
                    expected_seq=latest_seq,
                )

        self.assertIsInstance(adapter, ContextEventAdapter)
        self.assertEqual(latest_seq, 5)
        self.assertEqual(fake_http.latest_seq_called_with, "task_http")
        self.assertEqual(fake_http.append_payload["task_id"], "task_http")
        self.assertEqual(fake_http.append_payload["event"]["type"], "PLAN_CREATED")
        self.assertEqual(fake_http.append_payload["expected_seq"], 5)
        self.assertTrue(response["ok"])
        self.assertEqual(response["event_id"], "evt_http")
        self.assertEqual(adapter.get_latest_event_seq("task_http"), 6)


if __name__ == "__main__":
    unittest.main()
