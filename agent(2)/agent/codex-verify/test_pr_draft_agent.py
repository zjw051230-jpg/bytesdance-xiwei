import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "agent_core"))

from interfaces.event_adapter import MockEventAdapter
from interfaces.memory_adapter import InMemoryMemoryAdapter
from main import build_task_result
from orchestrator.state import AgentState
from tools.tool_registry import execute


def _state_for_pr_draft():
    state = AgentState(task_id="pr_draft_test", user_input="Add article word stats")
    state.artifacts["requirement_dsl"] = {
        "requirement_id": "REQ-PR-1",
        "requirement_type": "frontend",
        "task_name": "Add article word stats",
        "acceptance_criteria": ["Article detail page shows word count"],
    }
    state.artifacts["skill_match"] = {"matched_skill_id": "article-word-stats"}
    state.matched_skill = {"id": "article-word-stats", "name": "article-word-stats"}
    state.artifacts["plan"] = {
        "task_name": "Add article word stats",
        "test_commands": ["npm run lint"],
        "acceptance_criteria": ["Article detail page shows word count"],
    }
    state.artifacts["located_files"] = {
        "located": True,
        "files": [{"relative_path": "frontend/src/pages/Article.jsx"}],
    }
    state.artifacts["patch_plan"] = {
        "summary": "Add word count display to article page.",
        "patches": [
            {
                "file": "frontend/src/pages/Article.jsx",
                "reason": "Article detail page needs word count",
                "changes": ["Add word count calculation"],
                "risk_level": "low",
            }
        ],
    }
    state.artifacts["review"] = {
        "approved": True,
        "risk_level": "low",
        "issues": [],
        "checks": {"matches_acceptance_criteria": True},
    }
    state.artifacts["execution_result"] = {
        "executed": True,
        "mode": "real_repo_dry_run",
        "files": [
            {
                "file": "frontend/src/pages/Article.jsx",
                "status": "dry_run",
                "dry_run": True,
                "applied": False,
                "preview": False,
                "mode": "real_repo_dry_run",
            }
        ],
    }
    state.artifacts["verification_result"] = {
        "verified": True,
        "passed": True,
        "mode": "mock_test",
        "test_result": {
            "ok": True,
            "passed": True,
            "commands": [{"command": "npm run lint", "status": "passed"}],
        },
    }
    return state


class PrDraftAgentTest(unittest.TestCase):
    def test_finish_generates_pr_draft(self):
        state = _state_for_pr_draft()

        result = execute({"tool": "finish"}, state)

        draft = state.artifacts["pr_draft"]
        self.assertEqual(draft["status"], "ready")
        self.assertEqual(draft["title"], "Add article word stats")
        self.assertEqual(draft["requirement_id"], "REQ-PR-1")
        self.assertEqual(draft["requirement_type"], "frontend")
        self.assertEqual(draft["matched_skill_id"], "article-word-stats")
        self.assertEqual(draft["changed_files"][0]["file"], "frontend/src/pages/Article.jsx")
        self.assertIn("npm run lint", draft["test_commands"])
        self.assertEqual(result["result"]["final_summary"]["pr_draft"]["status"], "ready")

    def test_verification_failed_marks_pr_draft_blocked(self):
        state = _state_for_pr_draft()
        state.artifacts["verification_result"]["passed"] = False
        state.artifacts["verification_result"]["test_result"]["passed"] = False

        execute({"tool": "finish"}, state)

        self.assertEqual(state.artifacts["pr_draft"]["status"], "blocked")
        self.assertFalse(state.artifacts["pr_draft"]["risk_summary"]["verification_passed"])

    def test_conduit_pr_draft_contains_stack_and_key_files(self):
        state = _state_for_pr_draft()
        state.artifacts["requirement_dsl"]["requirement_type"] = "conduit_frontend"
        state.artifacts["task_level"] = "L1"
        state.artifacts["plan"]["metadata"] = {"conduit_scope": "frontend"}
        state.artifacts["repo_profile"] = {
            "repo_type": "conduit",
            "key_files": ["frontend/package.json", "backend/package.json", "frontend/src/main.jsx"],
        }

        execute({"tool": "finish"}, state)

        conduit = state.artifacts["pr_draft"]["conduit"]
        self.assertEqual(conduit["affected_stack"], "frontend")
        self.assertEqual(conduit["classification"], "L1")
        self.assertIn("frontend/package.json", conduit["key_files"])

    def test_json_result_contains_pr_draft(self):
        state = _state_for_pr_draft()
        execute({"tool": "finish"}, state)

        result = build_task_result(state, "state.json")

        self.assertIn("pr_draft", result)
        self.assertEqual(result["pr_draft"]["requirement_id"], "REQ-PR-1")

    def test_pr_draft_writes_event_memory_and_context(self):
        state = _state_for_pr_draft()
        memory = InMemoryMemoryAdapter()
        events = MockEventAdapter()

        with patch("tools.tool_registry.get_default_memory_adapter", return_value=memory), \
             patch("tools.tool_registry.get_default_event_adapter", return_value=events):
            execute({"tool": "finish"}, state)

        task_events = events.events_by_task[state.task_id]
        self.assertTrue(any(event["type"] == "PR_DRAFT_CREATED" for event in task_events))
        self.assertTrue(any(event["stage"] == "create_pr_draft" for event in memory.events))
        self.assertTrue(any(item["agent_name"] == "summaryAgent" for item in state.context_snapshots))


if __name__ == "__main__":
    unittest.main()
