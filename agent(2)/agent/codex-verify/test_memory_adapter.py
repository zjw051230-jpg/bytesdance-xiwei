import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "agent_core"))

from interfaces.memory_adapter import InMemoryMemoryAdapter, get_default_memory_adapter
from orchestrator.state import AgentState


class MemoryAdapterTest(unittest.TestCase):
    def test_in_memory_adapter_retrieve_and_save(self):
        adapter = InMemoryMemoryAdapter()
        adapter.save_case({"requirement": "文章详情页字数统计", "skill": "article_word_stats", "summary": "统计字数"})
        adapter.save_event({"stage": "finish", "action": "save_case", "timestamp": "2026-06-07T00:00:00"})

        hits = adapter.retrieve("字数统计", top_k=3)

        self.assertEqual(len(hits), 1)
        self.assertEqual(hits[0]["requirement"], "文章详情页字数统计")
        self.assertEqual(len(adapter.cases), 1)
        self.assertEqual(len(adapter.events), 1)

    def test_default_memory_adapter_returns_in_memory_adapter(self):
        adapter = get_default_memory_adapter()

        self.assertIsInstance(adapter, InMemoryMemoryAdapter)

    def test_agent_state_defaults_memory_hits(self):
        state = AgentState(task_id="memory_state_test", user_input="字数统计")

        self.assertEqual(state.memory_hits, [])


if __name__ == "__main__":
    unittest.main()
