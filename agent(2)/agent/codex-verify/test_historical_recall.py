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
from agents.locator_agent import locate_files
from agents.planner_agent import create_plan
from agents.reviewer_agent import review_patch_plan
from interfaces.event_adapter import MockEventAdapter
from interfaces.memory_adapter import InMemoryMemoryAdapter
from memory.historical_recall import recall_historical_cases
from orchestrator.agent_loop import run_agent
from orchestrator.state import AgentState


def _old_state(task_id, requirement_id="REQ-OLD", skill_id="article-word-stats"):
    state = AgentState(task_id=task_id, user_input="Old article stats requirement")
    state.artifacts["requirement_dsl"] = {
        "requirement_id": requirement_id,
        "task_name": "Old article stats requirement",
        "user_story": "As a reader I see article word count",
        "requirement_type": "frontend",
        "target_modules": ["frontend/src/pages/Article.jsx"],
        "acceptance_criteria": ["Article page shows word count"],
        "skill_hint": skill_id,
    }
    state.artifacts["skill_match"] = {"matched_skill_id": skill_id, "matched_skill_name": skill_id}
    state.matched_skill = {"id": skill_id, "name": skill_id}
    state.artifacts["plan"] = {
        "task_name": "Old article stats plan",
        "steps": ["Locate Article.jsx", "Render word count"],
        "target_modules": ["frontend/src/pages/Article.jsx"],
        "target_files_hint": ["frontend/src/pages/Article.jsx"],
        "acceptance_criteria": ["Article page shows word count"],
        "test_commands": ["npm run lint"],
    }
    state.artifacts["located_files"] = {
        "located": True,
        "files": [{"relative_path": "frontend/src/pages/Article.jsx"}],
    }
    state.artifacts["patch_plan"] = {
        "summary": "Old structured patch summary only",
        "patches": [
            {
                "file": "frontend/src/pages/Article.jsx",
                "changes": ["Add display"],
                "risk_level": "low",
            }
        ],
    }
    state.artifacts["review"] = {
        "approved": True,
        "risk_level": "medium",
        "issues": ["Check article render regression"],
        "checks": {"matches_acceptance_criteria": True},
    }
    state.artifacts["verification_result"] = {
        "passed": True,
        "test_result": {"commands": [{"command": "npm run lint"}]},
    }
    state.save()
    return state


class HistoricalRecallTest(unittest.TestCase):
    def test_no_history_returns_empty_recall(self):
        memory = InMemoryMemoryAdapter()
        events = MockEventAdapter()
        with patch("memory.historical_recall._load_state_candidates", return_value=[]):
            recall = recall_historical_cases(
                {"requirement_id": "REQ-NEW", "task_name": "Unrelated", "requirement_type": "backend"},
                {"id": "unknown"},
                memory_adapter=memory,
                event_adapter=events,
            )

        self.assertEqual(recall["recalled_cases"], [])
        self.assertEqual(recall["similarity_score"], 0)
        self.assertEqual(recall["reusable_file_hints"], [])

    def test_same_skill_recalls_old_case(self):
        _old_state("historical_old_skill", requirement_id="REQ-OLD-SKILL")
        recall = recall_historical_cases(
            {
                "requirement_id": "REQ-NEW-SKILL",
                "task_name": "New article stats",
                "requirement_type": "frontend",
                "target_modules": [],
                "acceptance_criteria": [],
            },
            {"id": "article-word-stats", "name": "article-word-stats"},
            memory_adapter=InMemoryMemoryAdapter(),
            event_adapter=MockEventAdapter(),
        )

        self.assertTrue(recall["recalled_cases"])
        self.assertIn("skill_id", recall["matched_fields"])
        self.assertIn("frontend/src/pages/Article.jsx", recall["reusable_file_hints"])

    def test_target_modules_overlap_recalls_old_case(self):
        _old_state("historical_old_module", requirement_id="REQ-OLD-MODULE", skill_id="generic")
        recall = recall_historical_cases(
            {
                "requirement_id": "REQ-NEW-MODULE",
                "task_name": "Profile module update",
                "requirement_type": "frontend",
                "target_modules": ["frontend/src/pages/Article.jsx"],
                "acceptance_criteria": [],
            },
            {"id": "generic", "name": "generic"},
            memory_adapter=InMemoryMemoryAdapter(),
            event_adapter=MockEventAdapter(),
        )

        self.assertTrue(recall["recalled_cases"])
        self.assertIn("target_modules", recall["matched_fields"])

    def test_recall_hints_enter_plan_locator_and_reviewer(self):
        recall = {
            "similarity_score": 50,
            "matched_fields": ["skill_id"],
            "reusable_plan_hints": ["Old plan hint"],
            "reusable_file_hints": ["frontend/src/pages/Article.jsx"],
            "reusable_test_commands": ["npm run lint"],
            "known_risks": ["Check article render regression"],
        }

        plan = create_plan(
            "new task",
            {"id": "generic", "name": "generic"},
            requirement_dsl={"task_name": "new task", "requirement_type": "frontend"},
            historical_recall=recall,
        )
        located = locate_files({"target_files_hint": []}, None, historical_recall=recall)
        review = review_patch_plan(
            plan,
            located,
            {"patches": [{"file": "frontend/src/pages/Article.jsx", "changes": ["Clarify implementation scope"]}]},
            {"id": "generic", "name": "generic"},
            historical_recall=recall,
        )

        self.assertIn("frontend/src/pages/Article.jsx", plan["target_files_hint"])
        self.assertIn("npm run lint", plan["test_commands"])
        self.assertEqual(located["strategy"], "historical_recall")
        self.assertIn("Check article render regression", review["historical_risks"])

    def test_secret_like_content_does_not_enter_recall(self):
        state = _old_state("historical_secret_old", requirement_id="REQ-OLD-SECRET")
        state.artifacts["located_files"] = {
            "located": True,
            "files": [{"relative_path": ".env"}, {"relative_path": "frontend/src/pages/Article.jsx"}],
        }
        state.artifacts["patch_plan"]["patches"].append(
            {"file": "backend/api_key_secret.js", "changes": ["TOKEN=abc"], "risk_level": "high"}
        )
        state.save()

        recall = recall_historical_cases(
            {
                "requirement_id": "REQ-NEW-SECRET",
                "task_name": "Article word count",
                "requirement_type": "frontend",
                "target_modules": ["frontend/src/pages/Article.jsx"],
                "acceptance_criteria": ["Article page shows word count"],
            },
            {"id": "article-word-stats", "name": "article-word-stats"},
            memory_adapter=InMemoryMemoryAdapter(),
            event_adapter=MockEventAdapter(),
        )

        text = json.dumps(recall)
        self.assertNotIn(".env", text)
        self.assertNotIn("api_key", text.lower())
        self.assertNotIn("TOKEN=abc", text)

    def test_json_result_contains_historical_recall(self):
        _old_state("historical_json_old", requirement_id="REQ-OLD-JSON")
        dsl = {
            "requirement_id": "REQ-NEW-JSON",
            "task_name": "Article stats again",
            "user_story": "As a reader I see article word count",
            "requirement_type": "frontend",
            "target_modules": ["frontend/src/pages/Article.jsx"],
            "acceptance_criteria": ["Article page shows word count"],
            "skill_hint": "article-word-stats",
        }
        stdin = io.StringIO(json.dumps(dsl))
        output = io.StringIO()
        with patch.object(sys, "stdin", stdin), patch.dict(os.environ, {"AGENT_OUTPUT_JSON": "1"}, clear=True), redirect_stdout(output):
            cli_main.main()

        data = json.loads(output.getvalue())
        self.assertIn("historical_recall", data)
        self.assertGreaterEqual(data["historical_recall"]["similarity_score"], 1)

    def test_run_agent_writes_recall_event_memory_and_context(self):
        _old_state("historical_event_old", requirement_id="REQ-OLD-EVENT")
        memory = InMemoryMemoryAdapter()
        events = MockEventAdapter()
        with patch("orchestrator.agent_loop.get_default_memory_adapter", return_value=memory), \
             patch("tools.tool_registry.get_default_memory_adapter", return_value=memory), \
             patch("tools.tool_registry.get_default_event_adapter", return_value=events), \
             patch("orchestrator.agent_loop.get_default_event_adapter", return_value=events):
            state = run_agent(
                "Article stats again",
                task_id="historical_event_new",
                requirement_dsl={
                    "requirement_id": "REQ-NEW-EVENT",
                    "task_name": "Article stats again",
                    "user_story": "As a reader I see article word count",
                    "requirement_type": "frontend",
                    "target_modules": ["frontend/src/pages/Article.jsx"],
                    "acceptance_criteria": ["Article page shows word count"],
                    "skill_hint": "article-word-stats",
                },
            )

        self.assertIn("historical_recall", state.artifacts)
        self.assertTrue(any(event["type"] == "HISTORICAL_RECALL_COMPLETED" for event in events.events_by_task[state.task_id]))
        self.assertTrue(any(event["stage"] == "historical_recall" for event in memory.events))
        self.assertTrue(any(item["agent_name"] == "memoryAgent" for item in state.context_snapshots))


if __name__ == "__main__":
    unittest.main()
