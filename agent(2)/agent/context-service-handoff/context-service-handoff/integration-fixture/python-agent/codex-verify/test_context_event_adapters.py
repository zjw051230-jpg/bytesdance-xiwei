import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "agent_core"))

from interfaces.context_adapter import MockContextAdapter, get_default_context_adapter
from interfaces.event_adapter import MockEventAdapter, get_default_event_adapter
from orchestrator.agent_loop import run_agent
from orchestrator.state import AgentState


class ContextEventAdapterTest(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
