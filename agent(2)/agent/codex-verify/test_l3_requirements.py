import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "agent_core"))

from agents.coder_agent import generate_patch_plan
from agents.planner_agent import create_plan
from main import build_task_result
from orchestrator.agent_loop import run_agent
from skills.registry import match_skill


DSL_DIR = Path(__file__).resolve().parents[1] / "agent_core" / "examples" / "dsl"


def load_dsl(name):
    return json.loads((DSL_DIR / name).read_text(encoding="utf-8"))


class L3RequirementTest(unittest.TestCase):
    def _conduit_profile(self):
        return {
            "repo_type": "conduit",
            "repo_path": "",
            "available_scripts": {"backend": {"test": "jest"}},
            "conduit_checks": {"ok": True},
        }

    def _plan_and_patch(self, dsl_name):
        dsl = load_dsl(dsl_name)
        skill = match_skill(dsl["user_input"], requirement_dsl=dsl)["skill"]
        plan = create_plan(
            dsl["user_input"],
            skill,
            requirement_dsl=dsl,
            repo_profile=self._conduit_profile(),
        )
        patch_plan = generate_patch_plan(dsl["user_input"], skill, plan, {"located": False, "files": []})
        return dsl, skill, plan, patch_plan

    def test_l3_ambiguous_does_not_generate_code_patch(self):
        _dsl, _skill, _plan, patch_plan = self._plan_and_patch("l3_ambiguous_article_experience.json")

        self.assertEqual(patch_plan["patches"], [])
        self.assertEqual(patch_plan["code_patches"], [])
        self.assertEqual(patch_plan["status"], "clarification_required")
        self.assertFalse(patch_plan["metadata"]["allow_code_patches"])

    def test_l3_ambiguous_produces_clarification_questions(self):
        _dsl, _skill, plan, patch_plan = self._plan_and_patch("l3_ambiguous_article_experience.json")

        self.assertGreaterEqual(len(plan["possible_interpretations"]), 3)
        self.assertGreaterEqual(len(patch_plan["clarification_questions"]), 1)
        self.assertTrue(any("typography" in item.lower() for item in plan["possible_interpretations"]))

    def test_l3_conflict_blocks_patch_generation(self):
        _dsl, _skill, plan, patch_plan = self._plan_and_patch("l3_conflicting_cover_image.json")

        self.assertEqual(plan["status"], "blocked")
        self.assertEqual(patch_plan["patches"], [])
        self.assertEqual(patch_plan["code_patches"], [])
        self.assertIn("requires storage", patch_plan["conflict_reason"])
        self.assertTrue(patch_plan["metadata"]["stop_before_execute"])

    def test_l3_multimodule_produces_staged_plan(self):
        _dsl, _skill, plan, patch_plan = self._plan_and_patch("l3_multimodule_rating.json")

        self.assertEqual(plan["status"], "planning_paused")
        self.assertEqual(patch_plan["status"], "planning_paused")
        self.assertEqual(patch_plan["patches"], [])
        staged_plan = patch_plan["staged_plan"]
        for key in ("backend", "frontend", "test", "risk"):
            self.assertIn(key, staged_plan)
            self.assertTrue(staged_plan[key])

    def test_l3_ambiguous_agent_pauses_before_execute_patch(self):
        dsl = load_dsl("l3_ambiguous_article_experience.json")

        with patch("orchestrator.agent_loop.profile_runtime_repo", return_value=self._conduit_profile()):
            state = run_agent(dsl["user_input"], task_id="l3_ambiguous_loop_test", requirement_dsl=dsl)

        actions = [item["action"]["tool"] for item in state.history]
        self.assertEqual(state.status, "PAUSED")
        self.assertIn("generate_patch", actions)
        self.assertNotIn("execute_patch", actions)
        self.assertEqual(state.artifacts["patch_plan"]["code_patches"], [])
        self.assertTrue(state.artifacts["l3_output"]["clarification_questions"])
        result = build_task_result(state)
        self.assertIn(result["status"], {"clarification_required", "paused"})
        self.assertEqual(result["raw_status"], "PAUSED")

    def test_l3_conflict_agent_pauses_before_execute_patch(self):
        dsl = load_dsl("l3_conflicting_cover_image.json")

        with patch("orchestrator.agent_loop.profile_runtime_repo", return_value=self._conduit_profile()):
            state = run_agent(dsl["user_input"], task_id="l3_conflict_loop_test", requirement_dsl=dsl)

        actions = [item["action"]["tool"] for item in state.history]
        self.assertEqual(state.status, "PAUSED")
        self.assertIn("generate_patch", actions)
        self.assertNotIn("execute_patch", actions)
        self.assertIn("conflict_reason", state.artifacts["patch_plan"])
        result = build_task_result(state)
        self.assertEqual(result["status"], "blocked")
        self.assertEqual(result["raw_status"], "PAUSED")

    def test_l3_multimodule_agent_status_is_planning_paused(self):
        dsl = load_dsl("l3_multimodule_rating.json")

        with patch("orchestrator.agent_loop.profile_runtime_repo", return_value=self._conduit_profile()):
            state = run_agent(dsl["user_input"], task_id="l3_multimodule_loop_test", requirement_dsl=dsl)

        actions = [item["action"]["tool"] for item in state.history]
        self.assertEqual(state.status, "PAUSED")
        self.assertIn("generate_patch", actions)
        self.assertNotIn("execute_patch", actions)
        result = build_task_result(state)
        self.assertIn(result["status"], {"planning_paused", "paused"})
        self.assertEqual(result["raw_status"], "PAUSED")
        self.assertTrue(result["staged_plan"]["backend"])


if __name__ == "__main__":
    unittest.main()
