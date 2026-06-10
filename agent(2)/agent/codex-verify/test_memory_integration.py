import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "agent_core"))

from interfaces.memory_adapter import InMemoryMemoryAdapter
from orchestrator.agent_loop import run_agent


class MemoryIntegrationTest(unittest.TestCase):
    def test_run_agent_populates_memory_hits_and_saves_case_on_finish(self):
        memory = InMemoryMemoryAdapter()
        memory.save_case({
            "requirement": "文章详情页字数统计",
            "skill": "article_word_stats",
            "summary": "已有案例",
        })

        with patch("orchestrator.agent_loop.get_default_memory_adapter", return_value=memory), \
             patch("tools.tool_registry.get_default_memory_adapter", return_value=memory), \
             patch("orchestrator.agent_loop.select_model", return_value={"model": "mock-model"}), \
             patch("orchestrator.agent_loop.read_control_signal", return_value=None), \
             patch("orchestrator.agent_loop.apply_control_signal", return_value=(True, "")), \
             patch("orchestrator.agent_loop.run_pre_hooks", return_value=Mock(ok=True)), \
             patch("orchestrator.agent_loop.run_post_hooks", return_value=Mock(ok=True)), \
             patch("orchestrator.agent_loop.decide_next_action", return_value={"tool": "finish", "args": {}}):
            state = run_agent("文章详情页字数统计", task_id="memory_integration_test")

        self.assertGreaterEqual(len(state.memory_hits), 1)
        self.assertEqual(state.artifacts.get("memory_hit_count"), len(state.memory_hits))
        self.assertGreaterEqual(len(memory.cases), 2)


if __name__ == "__main__":
    unittest.main()
