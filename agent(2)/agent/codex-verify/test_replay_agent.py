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
from orchestrator.agent_loop import run_agent
from orchestrator.state import AgentState


def _save_parent_state(task_id="replay_parent", requirement_id="REQ-REPLAY-1"):
    state = AgentState(task_id=task_id, user_input="Replay parent requirement")
    state.artifacts["requirement_dsl"] = {
        "requirement_id": requirement_id,
        "task_name": "Replay parent requirement",
        "user_story": "Replay parent requirement",
        "requirement_type": "frontend",
        "acceptance_criteria": ["Requirement intent is satisfied"],
    }
    state.artifacts["requirement_id"] = requirement_id
    state.artifacts["skill_match"] = {"matched_skill_id": "generic", "matched_skill_name": "generic"}
    state.matched_skill = {"id": "generic", "name": "generic"}
    state.artifacts["plan"] = {
        "task_name": "Original plan",
        "target_modules": ["frontend/src/pages/Article.jsx"],
        "target_files_hint": ["frontend/src/pages/Article.jsx"],
        "acceptance_criteria": ["Requirement intent is satisfied"],
        "test_commands": ["npm run lint"],
    }
    state.artifacts["located_files"] = {
        "located": True,
        "files": [{"path": "frontend/src/pages/Article.jsx", "relative_path": "frontend/src/pages/Article.jsx"}],
    }
    state.history = [
        {"step": 0, "action": {"tool": "select_skill"}, "observation": {"ok": True}},
        {"step": 1, "action": {"tool": "make_plan"}, "observation": {"ok": True}},
        {"step": 2, "action": {"tool": "locate_files"}, "observation": {"ok": True}},
    ]
    state.current_step = 9
    state.save()
    return state


class ReplayAgentTest(unittest.TestCase):
    def test_replay_from_generate_patch_runs_downstream(self):
        _save_parent_state(requirement_id="REQ-REPLAY-GEN")

        state = run_agent(
            "Replay parent requirement",
            task_id="replay_generate_patch_test",
            replay_request={
                "mode": "replay",
                "requirement_id": "REQ-REPLAY-GEN",
                "from_stage": "generate_patch",
                "overrides": {},
            },
        )

        actions = [item["action"]["tool"] for item in state.history]
        self.assertEqual(actions[0], "generate_patch")
        self.assertIn("review_patch", actions)
        self.assertIn("finish", actions)
        self.assertIn("patch_plan", state.artifacts)
        self.assertEqual(state.artifacts["replay"]["replay_from_stage"], "generate_patch")

    def test_replay_override_plan_takes_effect(self):
        _save_parent_state(requirement_id="REQ-REPLAY-PLAN")
        override_plan = {
            "task_name": "Override plan",
            "target_modules": ["frontend/src/pages/Profile.jsx"],
            "target_files_hint": ["frontend/src/pages/Profile.jsx"],
            "acceptance_criteria": ["Requirement intent is satisfied"],
            "test_commands": ["npm run lint"],
        }

        state = run_agent(
            "Replay parent requirement",
            task_id="replay_override_plan_test",
            replay_request={
                "mode": "replay",
                "requirement_id": "REQ-REPLAY-PLAN",
                "from_stage": "generate_patch",
                "overrides": {"plan": override_plan},
            },
        )

        self.assertEqual(state.artifacts["plan"]["task_name"], "Override plan")
        self.assertEqual(state.artifacts["pr_draft"]["title"], "Override plan")
        self.assertEqual(state.artifacts["replay"]["replay_overrides_keys"], ["plan"])

    def test_replay_does_not_repeat_upstream_stages(self):
        _save_parent_state(requirement_id="REQ-REPLAY-NO-UPSTREAM")

        state = run_agent(
            "Replay parent requirement",
            task_id="replay_no_upstream_test",
            replay_request={
                "mode": "replay",
                "requirement_id": "REQ-REPLAY-NO-UPSTREAM",
                "from_stage": "review_patch",
                "overrides": {
                    "patch_plan": {
                        "summary": "Replay patch plan",
                        "patches": [
                            {
                                "file": "frontend/src/pages/Article.jsx",
                                "changes": ["Clarify implementation scope"],
                                "risk_level": "low",
                            }
                        ],
                    }
                },
            },
        )

        actions = [item["action"]["tool"] for item in state.history]
        self.assertEqual(actions[0], "review_patch")
        self.assertNotIn("select_skill", actions)
        self.assertNotIn("make_plan", actions)
        self.assertNotIn("locate_files", actions)

    def test_replay_writes_events_memory_and_context(self):
        _save_parent_state(requirement_id="REQ-REPLAY-EVENT")
        memory = InMemoryMemoryAdapter()
        events = MockEventAdapter()

        with patch("orchestrator.agent_loop.get_default_memory_adapter", return_value=memory), \
             patch("tools.tool_registry.get_default_memory_adapter", return_value=memory), \
             patch("orchestrator.agent_loop.get_default_event_adapter", return_value=events), \
             patch("tools.tool_registry.get_default_event_adapter", return_value=events):
            state = run_agent(
                "Replay parent requirement",
                task_id="replay_event_test",
                replay_request={
                    "mode": "replay",
                    "requirement_id": "REQ-REPLAY-EVENT",
                    "from_stage": "generate_patch",
                    "overrides": {},
                },
            )

        event_types = [event["type"] for event in events.events_by_task[state.task_id]]
        self.assertIn("REPLAY_STARTED", event_types)
        self.assertIn("REPLAY_COMPLETED", event_types)
        self.assertTrue(any(event["stage"] == "replay" and event["action"] == "started" for event in memory.events))
        self.assertTrue(any(item["agent_name"] == "replayAgent" for item in state.context_snapshots))

    def test_illegal_from_stage_is_blocked(self):
        state = run_agent(
            "Replay parent requirement",
            task_id="replay_bad_stage_test",
            replay_request={
                "mode": "replay",
                "requirement_id": "REQ-REPLAY-BAD",
                "from_stage": "delete_everything",
                "overrides": {},
            },
        )

        self.assertEqual(state.status, "PAUSED")
        self.assertEqual(state.artifacts["replay"]["status"], "blocked")
        self.assertIn("Illegal replay from_stage", state.artifacts["blocked_reason"])

    def test_replay_json_result_contains_metadata(self):
        _save_parent_state(requirement_id="REQ-REPLAY-JSON")
        replay = {
            "mode": "replay",
            "requirement_id": "REQ-REPLAY-JSON",
            "from_stage": "generate_patch",
            "overrides": {"plan": {"task_name": "JSON replay plan", "test_commands": []}},
        }
        stdin = io.StringIO(json.dumps(replay))
        output = io.StringIO()

        with patch.object(sys, "stdin", stdin), patch.dict(os.environ, {"AGENT_OUTPUT_JSON": "1"}, clear=True), redirect_stdout(output):
            cli_main.main()

        data = json.loads(output.getvalue())
        self.assertIn("replay", data)
        self.assertEqual(data["replay"]["replay_parent_requirement_id"], "REQ-REPLAY-JSON")
        self.assertEqual(data["replay"]["replay_from_stage"], "generate_patch")
        self.assertEqual(data["replay"]["replay_overrides_keys"], ["plan"])


if __name__ == "__main__":
    unittest.main()
