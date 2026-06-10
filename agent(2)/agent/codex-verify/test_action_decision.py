import os
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "agent_core"))

import agents.fake_agent as fake_agent_module
import interfaces.event_adapter as event_adapter_module
from agents.fake_agent import decide_next_action
from interfaces.event_adapter import MockEventAdapter
from interfaces.memory_adapter import InMemoryMemoryAdapter
from orchestrator.agent_loop import run_agent
from orchestrator.state import AgentState


class FakeActionAdapter:
    def __init__(self, result):
        self.result = result

    def decide_action(self, state, available_actions, model_info):
        return {
            "thought": "fixed fake",
            "tool": "analyze_requirement",
            "args": {"selected_model": model_info["model"]},
        }

    def decide_action_with_llm(self, state, available_actions, model_info):
        return dict(self.result)


class ActionDecisionTest(unittest.TestCase):
    def tearDown(self):
        event_adapter_module._DEFAULT_EVENT_ADAPTER = None

    def test_default_fixed_sequence_unchanged(self):
        state = AgentState(task_id="decision_default", user_input="demo")

        with patch.dict(os.environ, {}, clear=True):
            action = decide_next_action(state, {"model": "mock-model"})

        self.assertEqual(action["tool"], "analyze_requirement")
        self.assertEqual(action["__decision"]["decision_source"], "mock")
        self.assertEqual(action["__decision"]["selected_action"], "analyze_requirement")

    def test_llm_action_decision_uses_valid_whitelisted_action(self):
        state = AgentState(task_id="decision_llm", user_input="demo")
        state.matched_skill = {"id": "generic", "name": "generic"}
        state.artifacts["plan"] = {"task_name": "demo plan"}
        adapter = FakeActionAdapter({
            "ok": True,
            "action": "locate_files",
            "tool": "locate_files",
            "reason": "Need to inspect candidate files",
            "confidence": 0.82,
            "provider": "doubao",
            "model": "ep-test",
        })

        with patch.dict(os.environ, {"AGENT_LLM_ACTION_DECISION": "1"}, clear=True), \
             patch("agents.fake_agent.get_default_llm_adapter", return_value=adapter):
            action = decide_next_action(state, {"model": "mock-model"})

        self.assertEqual(action["tool"], "locate_files")
        self.assertEqual(action["__decision"]["decision_source"], "llm")
        self.assertEqual(action["__decision"]["selected_action"], "locate_files")
        self.assertEqual(action["__decision"]["confidence"], 0.82)

    def test_llm_make_plan_without_matched_skill_falls_back_to_select_skill(self):
        state = AgentState(task_id="decision_missing_skill", user_input="demo")
        adapter = FakeActionAdapter({
            "ok": True,
            "action": "plan_task",
            "tool": "make_plan",
            "reason": "Try planning immediately",
            "confidence": 0.9,
            "provider": "doubao",
            "model": "ep-test",
        })

        with patch.dict(os.environ, {"AGENT_LLM_ACTION_DECISION": "1"}, clear=True), \
             patch("agents.fake_agent.get_default_llm_adapter", return_value=adapter):
            action = decide_next_action(state, {"model": "mock-model"})

        self.assertEqual(action["tool"], "select_skill")
        self.assertEqual(action["__decision"]["decision_source"], "fallback")
        self.assertEqual(action["__decision"]["rejected_action"], "plan_task")
        self.assertEqual(action["__decision"]["reason"], "missing_dependency: matched_skill")

    def test_generate_patch_only_once(self):
        state = AgentState(task_id="decision_patch_once", user_input="demo")
        state.matched_skill = {"id": "generic", "name": "generic"}
        state.artifacts["plan"] = {"task_name": "demo plan"}
        state.artifacts["located_files"] = {"located": True, "files": [{"path": "demo.py"}]}
        state.artifacts["patch_plan"] = {"summary": "Patch is ready", "patches": [{"file": "demo.py"}]}
        adapter = FakeActionAdapter({
            "ok": True,
            "action": "draft_patch",
            "tool": "generate_patch",
            "reason": "Try to draft again",
            "confidence": 0.9,
        })

        with patch.dict(os.environ, {"AGENT_LLM_ACTION_DECISION": "1"}, clear=True), \
             patch("agents.fake_agent.get_default_llm_adapter", return_value=adapter):
            action = decide_next_action(state, {"model": "mock-model"})

        self.assertEqual(action["tool"], "validate_patch")
        self.assertEqual(action["__decision"]["decision_source"], "fallback")
        self.assertEqual(action["__decision"]["rejected_action"], "draft_patch")
        self.assertEqual(action["__decision"]["reason"], "existing_artifact_requires: validate_patch")

    def test_patch_to_validation_transition(self):
        state = AgentState(task_id="decision_patch_to_review", user_input="demo")
        state.artifacts["patch_plan"] = {"summary": "Patch is ready", "patches": [{"file": "demo.py"}]}
        adapter = FakeActionAdapter({
            "ok": True,
            "action": "draft_patch",
            "tool": "generate_patch",
            "reason": "Patch already exists",
            "confidence": 0.9,
        })

        with patch.dict(os.environ, {"AGENT_LLM_ACTION_DECISION": "1"}, clear=True), \
             patch("agents.fake_agent.get_default_llm_adapter", return_value=adapter):
            action = decide_next_action(state, {"model": "mock-model"})

        self.assertEqual(action["tool"], "validate_patch")
        self.assertEqual(action["__decision"]["selected_action"], "validate_patch")

    def test_validation_to_review_transition(self):
        state = AgentState(task_id="decision_validation_to_review", user_input="demo")
        state.artifacts["patch_plan"] = {"summary": "Patch is ready", "patches": [{"file": "demo.py"}]}
        state.artifacts["validation_result"] = {"approved": True, "syntax_valid": True, "errors": [], "warnings": []}
        adapter = FakeActionAdapter({
            "ok": True,
            "action": "draft_patch",
            "tool": "generate_patch",
            "reason": "Patch already exists",
            "confidence": 0.9,
        })

        with patch.dict(os.environ, {"AGENT_LLM_ACTION_DECISION": "1"}, clear=True), \
             patch("agents.fake_agent.get_default_llm_adapter", return_value=adapter):
            action = decide_next_action(state, {"model": "mock-model"})

        self.assertEqual(action["tool"], "review_patch")
        self.assertEqual(action["__decision"]["selected_action"], "review_patch")

    def test_review_to_execute_transition(self):
        state = AgentState(task_id="decision_review_to_execute", user_input="demo")
        state.artifacts["patch_plan"] = {"summary": "Patch is ready", "patches": [{"file": "demo.py"}]}
        state.artifacts["validation_result"] = {"approved": True, "syntax_valid": True, "errors": [], "warnings": []}
        state.artifacts["review"] = {"approved": True, "summary": "Review passed"}
        adapter = FakeActionAdapter({
            "ok": True,
            "action": "review_patch",
            "tool": "review_patch",
            "reason": "Try to review again",
            "confidence": 0.9,
        })

        with patch.dict(os.environ, {"AGENT_LLM_ACTION_DECISION": "1"}, clear=True), \
             patch("agents.fake_agent.get_default_llm_adapter", return_value=adapter):
            action = decide_next_action(state, {"model": "mock-model"})

        self.assertEqual(action["tool"], "execute_patch")
        self.assertEqual(action["__decision"]["reason"], "existing_artifact_requires: execute_patch")

    def test_execute_to_verify_transition(self):
        state = AgentState(task_id="decision_execute_to_verify", user_input="demo")
        state.artifacts["patch_plan"] = {"summary": "Patch is ready", "patches": [{"file": "demo.py"}]}
        state.artifacts["validation_result"] = {"approved": True, "syntax_valid": True, "errors": [], "warnings": []}
        state.artifacts["review"] = {"approved": True, "summary": "Review passed"}
        state.artifacts["execution_result"] = {"executed": False, "mode": "preview"}
        adapter = FakeActionAdapter({
            "ok": True,
            "action": "execute_patch",
            "tool": "execute_patch",
            "reason": "Try to execute again",
            "confidence": 0.9,
        })

        with patch.dict(os.environ, {"AGENT_LLM_ACTION_DECISION": "1"}, clear=True), \
             patch("agents.fake_agent.get_default_llm_adapter", return_value=adapter):
            action = decide_next_action(state, {"model": "mock-model"})

        self.assertEqual(action["tool"], "verify_result")
        self.assertEqual(action["__decision"]["reason"], "existing_artifact_requires: verify_result")

    def test_llm_invalid_json_falls_back_to_fixed_sequence(self):
        state = AgentState(task_id="decision_invalid_json", user_input="demo")
        adapter = FakeActionAdapter({
            "ok": False,
            "error": "invalid_json: expected object",
        })

        with patch.dict(os.environ, {"AGENT_LLM_ACTION_DECISION": "1"}, clear=True), \
             patch("agents.fake_agent.get_default_llm_adapter", return_value=adapter):
            action = decide_next_action(state, {"model": "mock-model"})

        self.assertEqual(action["tool"], "analyze_requirement")
        self.assertEqual(action["__decision"]["decision_source"], "fallback")
        self.assertIn("invalid_json", action["__decision"]["reason"])

    def test_llm_unknown_action_falls_back_to_fixed_sequence(self):
        state = AgentState(task_id="decision_unknown", user_input="demo")
        adapter = FakeActionAdapter({
            "ok": False,
            "error": "unknown_action",
            "rejected_action": "delete_file",
            "confidence": 0.9,
        })

        with patch.dict(os.environ, {"AGENT_LLM_ACTION_DECISION": "1"}, clear=True), \
             patch("agents.fake_agent.get_default_llm_adapter", return_value=adapter):
            action = decide_next_action(state, {"model": "mock-model"})

        self.assertEqual(action["tool"], "analyze_requirement")
        self.assertEqual(action["__decision"]["decision_source"], "fallback")
        self.assertEqual(action["__decision"]["rejected_action"], "delete_file")
        self.assertEqual(action["__decision"]["reason"], "unknown_action")

    def test_run_agent_records_action_decision_state_event_context_and_memory(self):
        memory = InMemoryMemoryAdapter()
        events = MockEventAdapter()

        with patch("orchestrator.agent_loop.get_default_memory_adapter", return_value=memory), \
             patch("tools.tool_registry.get_default_memory_adapter", return_value=memory), \
             patch("orchestrator.agent_loop.get_default_event_adapter", return_value=events), \
             patch("tools.tool_registry.get_default_event_adapter", return_value=events), \
             patch("orchestrator.agent_loop.select_model", return_value={"model": "mock-model"}), \
             patch("orchestrator.agent_loop.decide_next_action", return_value={
                 "tool": "finish",
                 "args": {},
                 "__decision": {
                     "decision_source": "llm",
                     "selected_action": "summarize_result",
                     "selected_tool": "finish",
                     "rejected_action": None,
                     "reason": "Ready to summarize",
                     "confidence": 0.91,
                 },
             }):
            state = run_agent("demo", task_id="decision_event_test")

        self.assertEqual(state.status, "SUCCESS")
        self.assertEqual(state.artifacts["action_decisions"][0]["decision_source"], "llm")
        self.assertEqual(state.artifacts["last_action_decision_event"]["type"], "ACTION_DECIDED")
        self.assertTrue(any(item["agent_name"] == "actionSelector" for item in state.context_snapshots))
        self.assertTrue(any(event["stage"] == "action_decision" for event in memory.events))

    def test_hook_guard_rejects_llm_action_and_uses_fallback(self):
        memory = InMemoryMemoryAdapter()
        events = MockEventAdapter()
        llm_dangerous_action = {
            "tool": "apply_patch",
            "args": {
                "path": "frontend/src/pages/Article.test.js",
                "patch": "unsafe",
                "selected_model": "mock-model",
            },
            "__decision": {
                "decision_source": "llm",
                "selected_action": "execute_patch",
                "selected_tool": "apply_patch",
                "rejected_action": None,
                "reason": "Try unsafe edit",
                "confidence": 0.8,
            },
        }
        fallback_finish = {
            "tool": "finish",
            "args": {},
            "__decision": {
                "decision_source": "fallback",
                "selected_action": "summarize_result",
                "selected_tool": "finish",
                "rejected_action": "execute_patch",
                "reason": "hook_rejected: Dangerous edit blocked",
                "confidence": None,
            },
        }

        with patch("orchestrator.agent_loop.get_default_memory_adapter", return_value=memory), \
             patch("tools.tool_registry.get_default_memory_adapter", return_value=memory), \
             patch("orchestrator.agent_loop.get_default_event_adapter", return_value=events), \
             patch("tools.tool_registry.get_default_event_adapter", return_value=events), \
             patch("orchestrator.agent_loop.select_model", return_value={"model": "mock-model"}), \
             patch("orchestrator.agent_loop.decide_next_action", return_value=llm_dangerous_action), \
             patch("orchestrator.agent_loop.fixed_next_action", return_value=fallback_finish):
            state = run_agent("demo", task_id="decision_hook_test")

        decision = state.artifacts["action_decisions"][0]
        self.assertEqual(state.status, "SUCCESS")
        self.assertEqual(decision["decision_source"], "fallback")
        self.assertEqual(decision["rejected_action"], "execute_patch")
        self.assertEqual(decision["selected_tool"], "finish")


if __name__ == "__main__":
    unittest.main()
